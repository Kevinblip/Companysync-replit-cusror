'use strict';

const assert = require('node:assert/strict');
const { Client } = require('pg');
const {
  listCustomerCrewPhotos,
  publishCrewPhotos,
  setCrewSharePublic,
  validateStoredImageUrl,
} = require('../lib/crewPhotoSharing.cjs');

async function main() {
  const connectionString = process.env.CREW_PHOTO_TEST_DATABASE_URL;
  if (!connectionString) {
    console.log('Isolated PostgreSQL crew-photo test skipped (set CREW_PHOTO_TEST_DATABASE_URL).');
    return;
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    // The bridge expects pool.connect(); use one dedicated session and make
    // its release a no-op. All objects below are TEMP tables on this session.
    client.release = () => {};
    await client.query(`
      CREATE TEMP TABLE customers (id TEXT PRIMARY KEY, company_id TEXT NOT NULL);
      CREATE TEMP TABLE projects (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, customer_id TEXT,
        status TEXT, title TEXT, address TEXT, data JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TEMP TABLE staff_profiles (
        id TEXT PRIMARY KEY, company_id TEXT, user_email TEXT, email TEXT, is_active BOOLEAN
      );
      CREATE TEMP TABLE generic_entities (
        id TEXT NOT NULL, entity_type TEXT NOT NULL, company_id TEXT,
        data JSONB DEFAULT '{}', PRIMARY KEY (id, entity_type)
      );
      CREATE TEMP TABLE project_photos (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, company_id TEXT NOT NULL,
        photo_url TEXT NOT NULL, caption TEXT, milestone TEXT,
        is_public BOOLEAN NOT NULL DEFAULT false, uploaded_by TEXT, source_media_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TEMP TABLE file_uploads (id TEXT PRIMARY KEY, file_data BYTEA, mime_type TEXT);
    `);

    // Run the actual additive production columns against this intentionally
    // older temporary schema, then exercise the backfill against a legacy row.
    await client.query(`
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'standard';
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_milestone TEXT;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS related_customer_id TEXT;
      ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS source_customer_id TEXT;
      CREATE INDEX ON project_photos(company_id, source_customer_id, project_id);
      CREATE UNIQUE INDEX ON project_photos(project_id, source_media_id)
        WHERE source_media_id IS NOT NULL;
    `);
    await client.query(`
      INSERT INTO customers (id, company_id)
      VALUES ('cust-a', 'co-isolated'), ('cust-b', 'co-isolated');
      INSERT INTO staff_profiles (id, company_id, user_email, email, is_active)
      VALUES ('staff-1', 'co-isolated', 'staff@example.test', 'staff@example.test', true);
      INSERT INTO projects (id, company_id, customer_id, related_customer_id, status, title, address, data)
      VALUES ('project-test', 'co-isolated', 'cust-a', 'cust-a', 'active', 'Test project', '1 Test St', '{}'),
             ('project-cancelled', 'co-isolated', 'cust-a', 'cust-a', 'cancelled', 'Cancelled', '2 Test St', '{}');
      INSERT INTO generic_entities (id, entity_type, company_id, data)
      VALUES ('media-a', 'JobMedia', 'co-isolated',
              '{"related_entity_type":"Customer","related_entity_id":"cust-a","source":"crew_upload","file_type":"photo","file_url":"/uploads/photo.jpg"}'),
             ('legacy-a', 'JobMedia', 'co-isolated',
              '{"related_entity_type":"Customer","related_entity_id":"cust-a","source":"crew_upload","file_type":"photo","file_url":"/uploads/legacy.jpg"}');
      INSERT INTO project_photos (id, project_id, company_id, photo_url, is_public, uploaded_by, source_media_id)
      VALUES ('legacy-share', 'project-test', 'co-isolated', '/uploads/legacy.jpg', true, 'staff@example.test', 'legacy-a');
      INSERT INTO file_uploads (id, file_data, mime_type)
      VALUES ('db-photo.jpg', decode('89504e470d0a1a0a00000000', 'hex'), 'image/png');
    `);
    await client.query(`
      UPDATE project_photos pp
      SET source_customer_id = jm.data->>'related_entity_id'
      FROM generic_entities jm
      WHERE pp.source_customer_id IS NULL AND pp.source_media_id = jm.id
        AND pp.company_id = jm.company_id AND jm.entity_type = 'JobMedia'
        AND jm.data->>'related_entity_type' = 'Customer'
        AND jm.data->>'source' IN ('crew_upload', 'whatsapp_upload')
        AND NULLIF(jm.data->>'related_entity_id', '') IS NOT NULL;
    `);

    const pool = { query: client.query.bind(client), connect: async () => client };
    const actor = { email: 'staff@example.test' };
    assert.equal(await validateStoredImageUrl('/uploads/db-photo.jpg', {
      pool,
      downloadObject: async () => null,
      uploadsDir: '/definitely-not-an-upload-directory',
    }), true, 'bounded file_uploads fallback uses PostgreSQL BYTEA correctly');
    const published = await publishCrewPhotos(pool, {
      projectId: 'project-test',
      customerId: 'cust-a',
      authorizedCompanyId: 'co-isolated',
      actor,
      photos: [{ media_id: 'media-a', caption: 'PostgreSQL test' }],
    }, { validateImage: async () => true });
    assert.equal(published.shares.length, 1);
    const binding = await client.query(
      `SELECT source_customer_id FROM project_photos WHERE id = $1`,
      [published.shares[0].id]
    );
    assert.equal(binding.rows[0].source_customer_id, 'cust-a');

    const gallery = await listCustomerCrewPhotos(pool, 'cust-a', 'co-isolated', actor);
    assert.equal(gallery.shares.length, 2, 'new and backfilled legacy shares are owner-readable');
    await setCrewSharePublic(pool, {
      projectId: 'project-test',
      photoId: published.shares[0].id,
      authorizedCompanyId: 'co-isolated',
      actor,
      isPublic: false,
    });
    await client.query(`UPDATE projects SET related_customer_id = 'cust-b' WHERE id = 'project-test'`);
    const formerOwner = await listCustomerCrewPhotos(pool, 'cust-a', 'co-isolated', actor);
    const newOwner = await listCustomerCrewPhotos(pool, 'cust-b', 'co-isolated', actor);
    assert.equal(formerOwner.projects.some(project => project.id === 'project-test'), false);
    assert.equal(newOwner.projects.some(project => project.id === 'project-test'), true);
    assert.equal(newOwner.shares.some(share => share.project_id === 'project-test'), false,
      'relinking cannot transfer customer A shares to customer B');
    await assert.rejects(
      publishCrewPhotos(pool, {
        projectId: 'project-cancelled',
        customerId: 'cust-a',
        authorizedCompanyId: 'co-isolated',
        actor,
        photos: [{ media_id: 'media-a' }],
      }, { validateImage: async () => true }),
      error => error.statusCode === 404
    );
    const publicRows = await client.query(`
      SELECT pp.id FROM project_photos pp
      WHERE pp.company_id = $2 AND pp.project_id = ANY($1::text[])
        AND (pp.is_public = true OR pp.uploaded_by LIKE 'homeowner:%')
        AND EXISTS (
          SELECT 1 FROM projects p
          WHERE p.id = pp.project_id AND p.company_id = $2
            AND COALESCE(NULLIF(p.related_customer_id, ''), NULLIF(p.data->>'related_customer_id', ''), NULLIF(p.customer_id, ''), NULLIF(p.data->>'customer_id', '')) = $3
            AND p.status != 'cancelled'
        )
        AND (pp.source_media_id IS NULL OR pp.source_customer_id = $3 OR (
          pp.source_customer_id IS NULL AND EXISTS (
            SELECT 1 FROM generic_entities legacy_media
            WHERE legacy_media.id = pp.source_media_id
              AND legacy_media.entity_type = 'JobMedia'
              AND legacy_media.company_id = $2
              AND legacy_media.data->>'related_entity_type' = 'Customer'
              AND legacy_media.data->>'related_entity_id' = $3
              AND legacy_media.data->>'source' IN ('crew_upload', 'whatsapp_upload')
          )
        ))`, [['project-test'], 'co-isolated', 'cust-b']);
    assert.equal(publicRows.rows.length, 0, 'public reads exclude another customer’s source-bound shares');
    console.log('Isolated PostgreSQL crew-photo test passed (temporary tables only; no persistent rows or mail).');
  } catch (error) {
    if (error.name === 'AssertionError') {
      console.error(`Isolated PostgreSQL crew-photo test failed: ${error.message}`);
    } else {
      console.error(`Isolated PostgreSQL crew-photo test failed (${error.code || error.name || 'error'}).`);
    }
    process.exitCode = 1;
  } finally {
    if (connected) await client.end().catch(() => {});
  }
}

main().catch(error => {
  console.error(`Isolated PostgreSQL crew-photo test failed (${error.code || error.name || 'error'}).`);
  process.exitCode = 1;
});