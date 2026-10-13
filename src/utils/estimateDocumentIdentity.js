const ADDRESS_WORD_ALIASES = {
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
  northeast: 'ne',
  northwest: 'nw',
  southeast: 'se',
  southwest: 'sw',
  street: 'st',
  str: 'st',
  avenue: 'ave',
  av: 'ave',
  road: 'rd',
  drive: 'dr',
  boulevard: 'blvd',
  lane: 'ln',
  court: 'ct',
  circle: 'cir',
  highway: 'hwy',
  parkway: 'pkwy',
  place: 'pl',
  terrace: 'ter',
  trail: 'trl',
  square: 'sq',
  plaza: 'plz',
  route: 'rte',
  apartment: 'unit',
  apt: 'unit',
  suite: 'unit',
  ste: 'unit',
  unit: 'unit',
};

const STREET_SUFFIXES = new Set('st ave rd dr blvd ln ct cir hwy pkwy pl ter trl sq plz rte way'.split(' '));
const DIRECTIONS = new Set('n s e w ne nw se sw'.split(' '));
const STATE_CODES = new Set(
  'al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy'.split(' '),
);

function normalizedWords(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeName(value) {
  // Carrier PDFs commonly format "Last, First" while the CRM stores
  // "First Last". Compare the complete token set, not presentation order.
  return normalizedWords(value).sort().join(' ');
}

function addressWords(value) {
  return normalizedWords(
    String(value ?? '')
      .replace(/\b([ns])\.\s*([ew])\.?(?=\s|,|;|$)/gi, '$1$2')
      .replace(/#\s*(?=[a-z0-9])/gi, ' unit '),
  )
    .map((word) => ADDRESS_WORD_ALIASES[word] ?? word)
    .filter((word, index, words) => word !== 'unit' || words[index - 1] !== 'unit');
}

function addressParts(value) {
  const segments = String(value ?? '')
    .split(/[,;\n]+/)
    .map(addressWords)
    .filter((words) => words.length);
  let street = segments.shift() || [];

  // A comma before "Apt 5" does not turn the unit into a city. Keep it
  // attached to the street so different units cannot be treated as equal.
  while (segments[0]?.[0] === 'unit') street = street.concat(segments.shift());
  let locality = segments.flat();

  // City/state are sometimes written without a comma after the street. Only
  // separate that tail when a state or ZIP makes it recognizable as locality;
  // "100 Main St Annex" must not match "100 Main St" by prefix alone.
  // "St" can also occur in a street name ("St Johns Rd"). Use the last
  // street suffix rather than splitting the name at its first "St".
  let suffixIndex = -1;
  street.forEach((word, index) => {
    if (STREET_SUFFIXES.has(word)) suffixIndex = index;
  });
  if (suffixIndex !== -1) {
    let streetEnd = suffixIndex + 1;
    if (DIRECTIONS.has(street[streetEnd])) streetEnd += 1;
    if (street[streetEnd] === 'unit') streetEnd += 2;
    const tail = street.slice(streetEnd);
    if (tail.length && [...tail, ...locality].some((word) => STATE_CODES.has(word) || /^\d{5}$/.test(word))) {
      locality = tail.concat(locality);
      street = street.slice(0, streetEnd);
    }
  }
  return { street, locality };
}

function sameWords(left, right) {
  return left.length === right.length && left.every((word, index) => word === right[index]);
}

function localityAgrees(left, right) {
  // A street-only address is less complete, not a different property.
  if (!left.length || !right.length) return true;
  const leftZip = left.find((word) => /^\d{5}$/.test(word));
  const rightZip = right.find((word) => /^\d{5}$/.test(word));
  if (leftZip && rightZip && leftZip === rightZip) {
    const leftState = left.find((word) => STATE_CODES.has(word));
    const rightState = right.find((word) => STATE_CODES.has(word));
    // A ZIP+4 is often printed with a postal city that differs from the CRM's
    // municipality label. Same street + house number + ZIP is a strong match.
    return !leftState || !rightState || leftState === rightState;
  }
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (!shorter.every((word, index) => word === longer[index])) return false;
  // Missing state/ZIP is ordinary incomplete data. A longer city name is not:
  // "Cleveland" and "Cleveland Heights" can be different municipalities.
  return longer.slice(shorter.length).every((word) =>
    STATE_CODES.has(word) || /^\d{4,5}$/.test(word));
}

function differentAddress(left, right) {
  const a = addressParts(left);
  const b = addressParts(right);
  if (!a.street.length || !b.street.length) return false;
  return !sameWords(a.street, b.street) || !localityAgrees(a.locality, b.locality);
}

function displayValue(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'not provided';
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export function getEstimateDocumentIdentityMismatch({
  documentCustomer,
  documentAddress,
  currentCustomer,
  currentAddress,
  hasSelectedContact,
  documentLabel = 'document',
  currentLabel = 'current estimate',
  contextLabel = 'the document and open estimate',
} = {}) {
  const documentName = normalizeName(documentCustomer);
  const selectedName = normalizeName(currentCustomer);
  const customerMismatch = Boolean(hasSelectedContact && documentName && selectedName && documentName !== selectedName);
  const propertyMismatch = differentAddress(documentAddress, currentAddress);

  if (!customerMismatch && !propertyMismatch) return null;

  const details = [];
  if (customerMismatch) {
    details.push(
      `customer name (${documentLabel}: "${displayValue(documentCustomer)}"; ${currentLabel}: "${displayValue(currentCustomer)}")`,
    );
  }
  if (propertyMismatch) {
    details.push(
      `property address (${documentLabel}: "${displayValue(documentAddress)}"; ${currentLabel}: "${displayValue(currentAddress)}")`,
    );
  }

  return {
    customerMismatch,
    propertyMismatch,
    message: `Import blocked: ${contextLabel} disagree on ${details.join(' and ')}. Select the matching customer and property or correct the estimate details, then try again. No line items were imported.`,
  };
}

export function getEstimateDocumentBatchIdentityMismatch({
  documents = [],
  currentCustomer,
  currentAddress,
  hasSelectedContact,
} = {}) {
  const checked = [];
  for (const document of documents) {
    const info = document?.customer_info || {};
    const label = `document "${displayValue(document?.fileName)}"`;
    const currentMismatch = getEstimateDocumentIdentityMismatch({
      documentCustomer: info.customer_name,
      documentAddress: info.property_address,
      currentCustomer,
      currentAddress,
      hasSelectedContact,
      documentLabel: label,
    });
    if (currentMismatch) return currentMismatch;

    for (const earlier of checked) {
      const documentMismatch = getEstimateDocumentIdentityMismatch({
        documentCustomer: info.customer_name,
        documentAddress: info.property_address,
        currentCustomer: earlier.customer_info.customer_name,
        currentAddress: earlier.customer_info.property_address,
        hasSelectedContact: true,
        documentLabel: label,
        currentLabel: `document "${displayValue(earlier.fileName)}"`,
        contextLabel: 'the uploaded documents',
      });
      if (documentMismatch) return documentMismatch;
    }
    checked.push({ fileName: document?.fileName, customer_info: info });
  }
  return null;
}