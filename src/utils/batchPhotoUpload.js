const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Upload photos with bounded concurrency and timeouts. Uploads that finish during
 * the grace period remain available even if their first attempt exceeded timeout.
 */
export async function uploadBatchPhotos({
  files,
  compress,
  upload,
  createPreview,
  onProgress,
  onWaiting,
  timeoutMs = 60_000,
  graceMs = 30_000,
  concurrency = 4,
}) {
  const fileArr = Array.from(files || []);
  const results = new Array(fileArr.length).fill(null);
  const preparedFiles = new Array(fileArr.length).fill(null);
  const inFlight = [];
  let done = 0;

  const uploadOne = async (file, index) => {
    const preview = createPreview(file);
    const compressed = await compress(file, index);
    preparedFiles[index] = compressed;
    const uploadPromise = upload(compressed);
    const settled = uploadPromise
      .then(({ file_url }) => {
        if (file_url && !results[index]) {
          results[index] = { url: file_url, preview, name: file.name, index };
        }
      })
      .catch(() => {});
    inFlight.push(settled);
    await Promise.race([
      uploadPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('upload timed out')), timeoutMs)),
    ]);
  };

  const queue = fileArr.map((file, index) => ({ file, index }));
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const { file, index } = queue.shift();
      try {
        await uploadOne(file, index);
      } catch (error) {
        console.error(`Batch upload failed for photo ${index + 1} (${file.name}):`, error);
      }
      done++;
      onProgress?.(done, fileArr.length);
    }
  }));

  if (results.some(result => !result)) {
    onWaiting?.();
    await Promise.race([
      Promise.allSettled(inFlight),
      wait(graceMs),
    ]);
  }

  return {
    uploads: results.filter(Boolean),
    failedCount: fileArr.length - results.filter(Boolean).length,
    preparedFiles,
  };
}