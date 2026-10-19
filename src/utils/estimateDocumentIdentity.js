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

function streetIdentity(street) {
  const words = [...street];
  const unitAt = words.lastIndexOf('unit');
  let unit = '';
  if (unitAt !== -1) {
    unit = words.slice(unitAt + 1).join(' ');
    words.splice(unitAt);
  }
  const number = /^\d+[a-z]?$/.test(words[0] || '') ? words[0] : '';
  return { number, name: number ? words.slice(1) : words, unit };
}

function localityFields(locality) {
  const state = locality.find((word) => STATE_CODES.has(word)) || '';
  const zip = locality.find((word) => /^\d{5}$/.test(word)) || '';
  const city = locality.filter((word) => word !== state && !/^\d+$/.test(word));
  return { state, city, zip };
}

// House number, street name, unit, and state identify the property. City and
// ZIP are labels that carriers and municipalities print differently for the
// same house (Cleveland vs Cleveland Heights, 44128 vs 44118).
function classifyAddressConflict(left, right) {
  const a = addressParts(left);
  const b = addressParts(right);
  if (!a.street.length || !b.street.length) return null;

  const leftStreet = streetIdentity(a.street);
  const rightStreet = streetIdentity(b.street);
  if (
    leftStreet.number !== rightStreet.number
    || !sameWords(leftStreet.name, rightStreet.name)
    || leftStreet.unit !== rightStreet.unit
  ) {
    return 'block';
  }

  if (!a.locality.length || !b.locality.length) return null;
  const leftPlace = localityFields(a.locality);
  const rightPlace = localityFields(b.locality);
  if (leftPlace.state && rightPlace.state && leftPlace.state !== rightPlace.state) return 'block';

  const cityDiffers = leftPlace.city.length > 0
    && rightPlace.city.length > 0
    && !sameWords(leftPlace.city, rightPlace.city);
  const zipDiffers = Boolean(leftPlace.zip && rightPlace.zip && leftPlace.zip !== rightPlace.zip);
  if (cityDiffers || zipDiffers) return 'warn';
  return null;
}

export function customerAddressFieldsFromDocument(value) {
  const propertyAddress = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!propertyAddress) {
    return { property_address: '', street: '', city: '', state: '', zip: '' };
  }

  const zipMatches = [...propertyAddress.matchAll(/\b(\d{5})(?:-(\d{4}))?\b/g)]
    .filter((match) => match.index > 0);
  const zipMatch = zipMatches.length ? zipMatches[zipMatches.length - 1] : null;
  const zip = zipMatch ? zipMatch[1] : '';
  let rest = zipMatch
    ? `${propertyAddress.slice(0, zipMatch.index)} ${propertyAddress.slice(zipMatch.index + zipMatch[0].length)}`
    : propertyAddress;
  rest = rest.replace(/[,\s]+/g, ' ').replace(/\s+/g, ' ').trim();

  let state = '';
  const stateMatch = rest.match(/(?:^|\s)([A-Za-z]{2})$/);
  if (stateMatch && STATE_CODES.has(stateMatch[1].toLowerCase())) {
    state = stateMatch[1].toUpperCase();
    rest = rest.slice(0, stateMatch.index).trim();
  }

  const parsed = addressParts(propertyAddress);
  const streetWordCount = parsed.street.length;
  const words = rest.split(/\s+/).filter(Boolean);
  const street = streetWordCount > 0 && streetWordCount < words.length
    ? words.slice(0, streetWordCount).join(' ')
    : words.join(' ');
  const city = streetWordCount > 0 && streetWordCount < words.length
    ? words.slice(streetWordCount).join(' ')
    : '';

  return { property_address: propertyAddress, street, city, state, zip };
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
  const addressSeverity = classifyAddressConflict(documentAddress, currentAddress);
  const propertyMismatch = addressSeverity === 'block';
  const addressWarning = addressSeverity === 'warn' && !customerMismatch;

  if (!customerMismatch && !addressSeverity) return null;

  const details = [];
  if (customerMismatch) {
    details.push(
      `customer name (${documentLabel}: "${displayValue(documentCustomer)}"; ${currentLabel}: "${displayValue(currentCustomer)}")`,
    );
  }
  if (addressSeverity) {
    details.push(
      `property address (${documentLabel}: "${displayValue(documentAddress)}"; ${currentLabel}: "${displayValue(currentAddress)}")`,
    );
  }

  if (addressWarning) {
    return {
      customerMismatch: false,
      propertyMismatch: false,
      addressWarning: true,
      severity: 'warn',
      documentAddress: String(documentAddress ?? ''),
      currentAddress: String(currentAddress ?? ''),
      message: `Address warning: ${contextLabel} match on house number and street but differ in city or ZIP (${details.join(' and ')}). Import anyway, or update the customer's address to the document address. No line items were imported.`,
    };
  }

  return {
    customerMismatch,
    propertyMismatch: Boolean(addressSeverity),
    addressWarning: false,
    severity: 'block',
    documentAddress: String(documentAddress ?? ''),
    currentAddress: String(currentAddress ?? ''),
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
  let warning = null;
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
    if (currentMismatch?.severity === 'block') return currentMismatch;
    if (currentMismatch && !warning) warning = currentMismatch;

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
      if (documentMismatch?.severity === 'block') return documentMismatch;
      if (documentMismatch && !warning) warning = documentMismatch;
    }
    checked.push({ fileName: document?.fileName, customer_info: info });
  }
  return warning;
}