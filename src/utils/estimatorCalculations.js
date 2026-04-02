export function findItemInPriceList(priceList, searchTerms, fallback, { favoritesPriority = false, unitFilter = null } = {}) {
  const matchesExclusions = (desc, excludeList) => {
    if (!excludeList || excludeList.length === 0) return true;
    for (const w of excludeList) {
      if (desc.includes(w.toLowerCase())) return false;
    }
    return true;
  };

  const searchInList = (list) => {
    for (const code of searchTerms.codes || []) {
      const match = list.find(item => {
        if (item.code?.toUpperCase() !== code.toUpperCase()) return false;
        const desc = item.description?.toLowerCase() || '';
        if (!matchesExclusions(desc, searchTerms.exclude)) return false;
        if (unitFilter && item.unit?.toUpperCase() !== unitFilter.toUpperCase()) return false;
        return true;
      });
      if (match) return match;
    }
    for (const kw of searchTerms.keywords || []) {
      const match = list.find(item => {
        const desc = item.description?.toLowerCase() || '';
        if (!desc.includes(kw.toLowerCase())) return false;
        if (!matchesExclusions(desc, searchTerms.exclude)) return false;
        if (unitFilter && item.unit?.toUpperCase() !== unitFilter.toUpperCase()) return false;
        return true;
      });
      if (match) return match;
    }
    return null;
  };

  if (favoritesPriority) {
    const favorites = priceList.filter(item => item.is_favorite);
    if (favorites.length > 0) {
      const favMatch = searchInList(favorites);
      if (favMatch) return favMatch;
    }
  }

  const match = searchInList(priceList);
  return match || fallback;
}

function findMetalItem(priceList, codes, keywords, fallback, unit = null) {
  const exclude = ['asphalt', 'shingle', 'composition'];
  return findItemInPriceList(priceList, { codes, keywords, exclude }, fallback, { unitFilter: unit });
}

function findFlatRoofItem(priceList, codes, keywords, fallback, unit = null) {
  const exclude = ['asphalt', 'shingle', 'composition'];
  return findItemInPriceList(priceList, { codes, keywords, exclude }, fallback, { unitFilter: unit });
}

function pushLineItem(items, lineNumber, item, quantity, unit) {
  const price = Number(item.price) || 0;
  items.push({
    line: lineNumber,
    code: item.code,
    description: item.description,
    quantity,
    unit,
    rate: price,
    rcv: price * quantity,
    acv: price * quantity,
    amount: price * quantity,
    depreciation: 0
  });
}

function pushLineItemWithNotes(items, lineNumber, item, quantity, unit, notes) {
  const entry = {
    line: lineNumber,
    code: item.code,
    description: item.description,
    quantity,
    unit,
    rate: Number(item.price) || 0,
    rcv: (Number(item.price) || 0) * quantity,
    acv: (Number(item.price) || 0) * quantity,
    amount: (Number(item.price) || 0) * quantity,
    depreciation: 0
  };
  if (notes) entry.notes = notes;
  items.push(entry);
}

export function buildMetalRoofLineItems(measurements, priceList) {
  const items = [];
  let lineNumber = 1;
  const squares = Number(measurements.roof_area_sq) || 0;

  if (squares > 0) {
    const panelItem = findMetalItem(priceList, ['RFG METAL', 'METAL', 'STANDING SEAM'], ['metal panel', 'standing seam', 'corrugated metal'], { price: 650, unit: "SQ", code: "METAL", description: "Metal Roof Panels - Standing Seam" }, "SQ");
    pushLineItem(items, lineNumber++, panelItem, squares, "SQ");
  }

  if (squares > 0) {
    const underlaymentItem = findMetalItem(priceList, ['RFG UL SYN', 'SYNTH HT'], ['synthetic underlayment high temp', 'high-temp underlayment'], { price: 45, unit: "SQ", code: "UL-HT", description: "Underlayment, synthetic, high-temp for metal" }, "SQ");
    pushLineItem(items, lineNumber++, underlaymentItem, squares, "SQ");
  }

  const eavesLF = Math.round((Number(measurements.eave_lf) || 0) * 100) / 100;
  const valleysLF = Math.round((Number(measurements.valley_lf) || 0) * 100) / 100;
  const totalIceWater = Math.ceil((eavesLF * 2 + valleysLF) * 1.10);
  if (totalIceWater > 0) {
    const iceWaterItem = findMetalItem(priceList, ['IWS', 'RFG IWS'], ['ice & water barrier'], { price: 2.25, unit: "LF", code: "IWS", description: "Ice & water barrier" });
    pushLineItem(items, lineNumber++, iceWaterItem, totalIceWater, "LF");
  }

  const ridgeLF = Math.round((Number(measurements.ridge_lf) || 0) * 100) / 100;
  if (ridgeLF > 0) {
    const ridgeItem = findMetalItem(priceList, ['RIDGE M', 'METAL RIDGE'], ['ridge cap metal', 'metal ridge'], { price: 15, unit: "LF", code: "RIDGE M", description: "Ridge Cap - Metal" });
    pushLineItem(items, lineNumber++, ridgeItem, ridgeLF, "LF");
  }

  const hipLF = Math.round((Number(measurements.hip_lf) || 0) * 100) / 100;
  if (hipLF > 0) {
    const hipItem = findMetalItem(priceList, ['HIP M'], ['hip cap metal'], { price: 15, unit: "LF", code: "HIP M", description: "Hip Cap - Metal" });
    pushLineItem(items, lineNumber++, hipItem, hipLF, "LF");
  }

  if (valleysLF > 0) {
    const valleyItem = findMetalItem(priceList, ['VMTLWP'], ['valley metal', 'w valley'], { price: 12, unit: "LF", code: "VMTLWP", description: "Valley metal - (W) profile - painted" });
    pushLineItem(items, lineNumber++, valleyItem, valleysLF, "LF");
  }

  const rakeLF = Math.round((Number(measurements.rake_lf) || 0) * 100) / 100;
  const totalEdge = rakeLF + eavesLF;
  if (totalEdge > 0) {
    const dripItem = findMetalItem(priceList, ['RFG DE', 'DRIP'], ['drip edge', 'eave trim'], { price: 3.5, unit: "LF", code: "DRIP", description: "Drip edge, metal" });
    pushLineItem(items, lineNumber++, dripItem, totalEdge, "LF");
  }

  const stepFlashLF = Math.round((Number(measurements.step_flashing_lf) || 0) * 100) / 100;
  if (stepFlashLF > 0) {
    const flashItem = findMetalItem(priceList, ['RFG FLS'], ['step flashing'], { price: 4.5, unit: "LF", code: "RFG FLS", description: "Step flashing, metal" });
    pushLineItem(items, lineNumber++, flashItem, stepFlashLF, "LF");
  }

  if (squares > 0) {
    const fastenerItem = findMetalItem(priceList, ['FASTENERS', 'SCREWS'], ['metal roof fasteners', 'roofing screws'], { price: 25, unit: "SQ", code: "FASTENERS", description: "Fasteners and screws for metal panels" });
    pushLineItem(items, lineNumber++, fastenerItem, squares, "SQ");
  }

  if (squares > 0) {
    const tearOffItem = findMetalItem(priceList, ['ARMV', 'TEAR', 'REMOVE'], ['remove roof', 'tear off shingle', 'tear off composition'], { price: 85, unit: "SQ", code: "ARMV", description: "Remove existing roof covering - composition" });
    pushLineItem(items, lineNumber++, tearOffItem, squares, "SQ");
  }

  return { items, squares };
}

export function buildFlatRoofLineItems(measurements, priceList) {
  const items = [];
  let lineNumber = 1;
  const squares = Number(measurements.roof_area_sq) || 0;
  const perimeter = Number(measurements.eave_lf) + Number(measurements.rake_lf) || 0;

  if (squares > 0) {
    const membraneItem = findFlatRoofItem(priceList, ['EPDM', 'TPO', 'RFG EPDM'], ['epdm membrane', 'rubber membrane', 'tpo membrane'], { price: 450, unit: "SQ", code: "EPDM", description: "EPDM Membrane - 60 mil" }, "SQ");
    const wasteMultiplier = 1.15;
    const qty = squares * wasteMultiplier;
    pushLineItemWithNotes(items, lineNumber++, membraneItem, qty, "SQ", `Includes ${((wasteMultiplier - 1) * 100).toFixed(0)}% waste factor`);
  }

  if (squares > 0) {
    const insulationItem = findFlatRoofItem(priceList, ['INSUL', 'POLYISO'], ['polyiso insulation', 'roof insulation', 'insulation board'], { price: 120, unit: "SQ", code: "INSUL", description: "Polyiso Insulation - 2 inch" }, "SQ");
    pushLineItem(items, lineNumber++, insulationItem, squares, "SQ");
  }

  if (squares > 0) {
    const coverBoardItem = findFlatRoofItem(priceList, ['COVER', 'GYPSUM'], ['cover board', 'gypsum board'], { price: 85, unit: "SQ", code: "COVER", description: "Cover Board - 1/2 inch Gypsum" }, "SQ");
    pushLineItem(items, lineNumber++, coverBoardItem, squares, "SQ");
  }

  if (perimeter > 0) {
    const termBarItem = findFlatRoofItem(priceList, ['TERM', 'TERMBAR'], ['termination bar', 'edge bar'], { price: 8.50, unit: "LF", code: "TERMBAR", description: "Termination Bar - Aluminum" }, "LF");
    pushLineItem(items, lineNumber++, termBarItem, perimeter, "LF");
  }

  if (perimeter > 0) {
    const edgeMetalItem = findFlatRoofItem(priceList, ['EDGE', 'GRAVEL'], ['edge metal', 'gravel stop', 'drip edge'], { price: 12.00, unit: "LF", code: "EDGE", description: "Edge Metal / Gravel Stop" }, "LF");
    pushLineItem(items, lineNumber++, edgeMetalItem, perimeter, "LF");
  }

  const drainCount = Math.max(1, Math.ceil((squares * 100) / 600));
  if (drainCount > 0) {
    const drainItem = findFlatRoofItem(priceList, ['DRAIN', 'RFG DRAIN'], ['roof drain', 'drain cast iron'], { price: 250, unit: "EA", code: "DRAIN", description: "Roof Drain - 4 inch Cast Iron" }, "EA");
    pushLineItem(items, lineNumber++, drainItem, drainCount, "EA");
  }

  if (squares > 0) {
    const fastenerItem = findFlatRoofItem(priceList, ['FASTENER', 'PLATE'], ['insulation fastener', 'fastener plate'], { price: 45, unit: "SQ", code: "FASTENERS", description: "Insulation Fasteners & Plates" }, "SQ");
    pushLineItem(items, lineNumber++, fastenerItem, squares, "SQ");
  }

  if (squares > 0) {
    const tearOffItem = findFlatRoofItem(priceList, ['TEAR', 'REMOVE'], ['remove roof', 'tear off membrane'], { price: 125, unit: "SQ", code: "TEAR", description: "Remove existing flat roof membrane & insulation" }, "SQ");
    pushLineItem(items, lineNumber++, tearOffItem, squares, "SQ");
  }

  if (squares > 0) {
    const laborItem = findFlatRoofItem(priceList, ['LABOR', 'INSTALL'], ['flat roof labor', 'epdm installation'], { price: 200, unit: "SQ", code: "LABOR-FLAT", description: "Flat Roof Installation Labor" }, "SQ");
    pushLineItem(items, lineNumber++, laborItem, squares, "SQ");
  }

  if (squares > 0) {
    const warrantyItem = findFlatRoofItem(priceList, ['WARRANTY'], ['manufacturer warranty', 'NDL warranty'], { price: 25, unit: "SQ", code: "WARRANTY", description: "Manufacturer NDL Warranty - 20 Year" }, "SQ");
    pushLineItem(items, lineNumber++, warrantyItem, squares, "SQ");
  }

  return { items, squares, perimeter, drainCount };
}

export function buildSidingLineItems(measurements, priceList, sidingWastePct) {
  const items = [];
  let lineNumber = 1;

  const findSidingItem = (searchTerms, fallback) => {
    return findItemInPriceList(priceList, searchTerms, fallback);
  };

  const wastePct = measurements._wasteOverride != null ? Number(measurements._wasteOverride) : (Number(sidingWastePct) || 0);
  const wasteMultiplier = 1 + (wastePct / 100);
  const wallAreaSQ = (Number(measurements.wall_area_sq) || (Number(measurements.wall_area_sqft) / 100) || 0) * wasteMultiplier;
  const wallAreaSF = (Number(measurements.wall_area_sqft) || ((Number(measurements.wall_area_sq) || 0) * 100) || 0) * wasteMultiplier;

  if (wallAreaSQ > 0) {
    const removalItem = findSidingItem({ codes: ['SID REM', 'REMOVE SIDING'], keywords: ['remove siding', 'removal siding', 'tear off siding'], exclude: [] }, { price: 45, unit: "SQ", code: "SID REM", description: "Remove siding, vinyl or aluminum" });
    pushLineItem(items, lineNumber++, removalItem, wallAreaSQ, "SQ");
  }

  if (wallAreaSQ > 0) {
    const sidingItem = findSidingItem({ codes: ['SID VS', 'VINYL SIDING'], keywords: ['vinyl siding', 'siding vinyl'], exclude: ['removal', 'remove', 'soffit', 'fascia', 'trim', 'corner'] }, { price: 425, unit: "SQ", code: "SID VS", description: "Vinyl siding, standard grade" });
    pushLineItem(items, lineNumber++, sidingItem, wallAreaSQ, "SQ");
  }

  const wallTopLF = Number(measurements.wall_top_lf) || 0;
  if (wallTopLF > 0) {
    const jChannelItem = findSidingItem({ codes: ['SID J', 'J-CHANNEL'], keywords: ['j-channel', 'j channel'], exclude: [] }, { price: 3.50, unit: "LF", code: "SID J", description: "J-channel, vinyl" });
    const price = Number(jChannelItem.price) || 0;
    items.push({ line: lineNumber++, code: jChannelItem.code, description: jChannelItem.description + " (Top)", quantity: wallTopLF, unit: "LF", rate: price, rcv: price * wallTopLF, acv: price * wallTopLF, amount: price * wallTopLF, depreciation: 0 });
  }

  const wallBottomLF = Number(measurements.wall_bottom_lf) || 0;
  if (wallBottomLF > 0) {
    const jChannelItem = findSidingItem({ codes: ['SID J', 'J-CHANNEL'], keywords: ['j-channel', 'j channel'], exclude: [] }, { price: 3.50, unit: "LF", code: "SID J", description: "J-channel, vinyl" });
    const price = Number(jChannelItem.price) || 0;
    items.push({ line: lineNumber++, code: jChannelItem.code, description: jChannelItem.description + " (Bottom)", quantity: wallBottomLF, unit: "LF", rate: price, rcv: price * wallBottomLF, acv: price * wallBottomLF, amount: price * wallBottomLF, depreciation: 0 });
  }

  const insideCornersLF = Number(measurements.inside_corners_lf) || 0;
  if (insideCornersLF > 0) {
    const insideCornerItem = findSidingItem({ codes: ['SID IC', 'INSIDE CORNER'], keywords: ['inside corner', 'corner inside'], exclude: [] }, { price: 4.25, unit: "LF", code: "SID IC", description: "Inside corner, vinyl" });
    pushLineItemWithNotes(items, lineNumber++, insideCornerItem, insideCornersLF, "LF", `${measurements.inside_corners_count || 0} corners`);
  }

  const outsideCornersLF = Number(measurements.outside_corners_lf) || 0;
  if (outsideCornersLF > 0) {
    const outsideCornerItem = findSidingItem({ codes: ['SID OC', 'OUTSIDE CORNER'], keywords: ['outside corner', 'corner outside'], exclude: [] }, { price: 4.25, unit: "LF", code: "SID OC", description: "Outside corner, vinyl" });
    pushLineItemWithNotes(items, lineNumber++, outsideCornerItem, outsideCornersLF, "LF", `${measurements.outside_corners_count || 0} corners`);
  }

  const perimeterLF = Number(measurements.perimeter_ft) || wallBottomLF || 0;
  if (wallBottomLF > 0) {
    const stripsNeeded = Math.ceil(wallBottomLF / 12);
    const starterItem = findSidingItem({ codes: ['SID SS', 'STARTER'], keywords: ['starter strip'], exclude: ['shingle', 'roof', 'layer', 'board', 'foam', 'rigid'] }, { price: 8.50, unit: "EA", code: "SID SS", description: "Starter strips, vinyl (12 ft ea)" });
    const price = Number(starterItem.price) || 0;
    items.push({ line: lineNumber++, code: starterItem.code, description: `Starter strips, vinyl (12 ft ea) — ${wallBottomLF} LF ÷ 12`, quantity: stripsNeeded, unit: "EA", rate: price, rcv: price * stripsNeeded, acv: price * stripsNeeded, amount: price * stripsNeeded, depreciation: 0 });
  }

  if (wallAreaSQ > 0) {
    const houseWrapItem = findSidingItem({ codes: ['WP', 'HOUSE WRAP', 'HOUSEWRAP'], keywords: ['house wrap', 'housewrap', 'weather barrier', 'building wrap'], exclude: [] }, { price: 55, unit: "SQ", code: "WP", description: "House wrap / weather barrier" });
    pushLineItem(items, lineNumber++, houseWrapItem, wallAreaSQ, "SQ");
  }

  if (wallAreaSQ > 0) {
    const nailBoxes = Math.ceil(wallAreaSQ * 0.18);
    const nailItem = findSidingItem({ codes: ['SID NAIL', 'NAILS'], keywords: ['siding nail', 'nail', 'fastener'], exclude: ['roofing'] }, { price: 45, unit: "EA", code: "SID NAIL", description: "Nails, 25-lb box (siding)" });
    pushLineItemWithNotes(items, lineNumber++, nailItem, nailBoxes, "EA", `${wallAreaSQ.toFixed(1)} SQ × 0.18 boxes/SQ`);
  }

  if (perimeterLF > 0) {
    const caulkQty = Math.max(2, Math.ceil(perimeterLF / 60));
    const caulkItem = findSidingItem({ codes: ['CAULK', 'SID CLK'], keywords: ['caulk', 'sealant'], exclude: [] }, { price: 8, unit: "EA", code: "CAULK", description: "Caulk, exterior grade (tube)" });
    pushLineItem(items, lineNumber++, caulkItem, caulkQty, "EA");
  }

  {
    const lightBoxItem = findSidingItem({ codes: ['EL BOX', 'ELEC EXT'], keywords: ['electrical box', 'light box', 'box extension', 'electrical ext'], exclude: [] }, { price: 15, unit: "EA", code: "EL BOX", description: "Electrical box extension (light box)" });
    const price = Number(lightBoxItem.price) || 0;
    items.push({ line: lineNumber++, code: lightBoxItem.code, description: lightBoxItem.description, quantity: 1, unit: "EA", rate: price, rcv: price * 1, acv: price * 1, amount: price * 1, depreciation: 0 });
  }

  {
    const waterBibItem = findSidingItem({ codes: ['SID WB', 'HOSE BIB', 'WATER BIB'], keywords: ['hose bib', 'water spigot', 'water bib', 'exterior faucet'], exclude: [] }, { price: 75, unit: "EA", code: "SID WB", description: "Exterior water spigot / hose bib (cut-in & reconnect)" });
    const price = Number(waterBibItem.price) || 75;
    items.push({ line: lineNumber++, code: waterBibItem.code, description: waterBibItem.description, quantity: 1, unit: "EA", rate: price, rcv: price, acv: price, amount: price, depreciation: 0 });
  }

  {
    const haulItem = findSidingItem({ codes: ['HAUL', 'DUMP', 'DEBRIS'], keywords: ['haul off', 'debris removal', 'dumpster', 'disposal'], exclude: [] }, { price: 350, unit: "EA", code: "HAUL", description: "Haul off / debris disposal" });
    const price = Number(haulItem.price) || 350;
    items.push({ line: lineNumber++, code: haulItem.code, description: haulItem.description, quantity: 1, unit: "EA", rate: price, rcv: price, acv: price, amount: price, depreciation: 0 });
  }

  return { items, wallAreaSQ, wallAreaSF, wallTopLF, wallBottomLF, insideCornersLF, outsideCornersLF };
}

export function buildSidingLineItemsArray(measurements, priceList, sidingWastePct) {
  const items = [];
  let lineNumber = 1;

  const findSidingItem = (searchTerms, fallback) => {
    return findItemInPriceList(priceList, searchTerms, fallback);
  };

  const wastePctArr = Number(sidingWastePct) || 0;
  const wasteMultiplierArr = 1 + (wastePctArr / 100);
  const wallAreaSQ = (Number(measurements.wall_area_sq) || (Number(measurements.wall_area_sqft) / 100) || 0) * wasteMultiplierArr;

  if (wallAreaSQ > 0) {
    const removal = findSidingItem({ codes: ['SID REM'], keywords: ['remove siding'], exclude: [] }, { price: 45, unit: "SQ", code: "SID REM", description: "Remove siding, vinyl or aluminum" });
    pushLineItem(items, lineNumber++, removal, wallAreaSQ, "SQ");

    const siding = findSidingItem({ codes: ['SID VS'], keywords: ['vinyl siding'], exclude: [] }, { price: 425, unit: "SQ", code: "SID VS", description: "Vinyl siding, standard grade" });
    pushLineItem(items, lineNumber++, siding, wallAreaSQ, "SQ");
  }

  if (measurements.wall_top_lf > 0) {
    const jChannel = findSidingItem({ codes: ['SID J'], keywords: ['j-channel'], exclude: [] }, { price: 3.50, unit: "LF", code: "SID J", description: "J-channel, vinyl" });
    const price = Number(jChannel.price) || 0;
    items.push({ line: lineNumber++, code: jChannel.code, description: jChannel.description + " (Top)", quantity: measurements.wall_top_lf, unit: "LF", rate: price, rcv: price * measurements.wall_top_lf, acv: price * measurements.wall_top_lf, amount: price * measurements.wall_top_lf, depreciation: 0 });
  }

  if (measurements.wall_bottom_lf > 0) {
    const jChannel = findSidingItem({ codes: ['SID J'], keywords: ['j-channel'], exclude: [] }, { price: 3.50, unit: "LF", code: "SID J", description: "J-channel, vinyl" });
    const price = Number(jChannel.price) || 0;
    items.push({ line: lineNumber++, code: jChannel.code, description: jChannel.description + " (Bottom)", quantity: measurements.wall_bottom_lf, unit: "LF", rate: price, rcv: price * measurements.wall_bottom_lf, acv: price * measurements.wall_bottom_lf, amount: price * measurements.wall_bottom_lf, depreciation: 0 });
  }

  if (measurements.inside_corners_lf > 0) {
    const corner = findSidingItem({ codes: ['SID IC'], keywords: ['inside corner'], exclude: [] }, { price: 4.25, unit: "LF", code: "SID IC", description: "Inside corner, vinyl" });
    pushLineItem(items, lineNumber++, corner, measurements.inside_corners_lf, "LF");
  }

  if (measurements.outside_corners_lf > 0) {
    const corner = findSidingItem({ codes: ['SID OC'], keywords: ['outside corner'], exclude: [] }, { price: 4.25, unit: "LF", code: "SID OC", description: "Outside corner, vinyl" });
    pushLineItem(items, lineNumber++, corner, measurements.outside_corners_lf, "LF");
  }

  const perimeterLFArr = Number(measurements.perimeter_ft) || Number(measurements.wall_bottom_lf) || 0;
  const wallBottomLFArr = Number(measurements.wall_bottom_lf) || 0;

  if (wallBottomLFArr > 0) {
    const starter = findSidingItem({ codes: ['SID SS', 'STARTER'], keywords: ['starter strip', 'starter'], exclude: ['shingle', 'roof'] }, { price: 2.50, unit: "LF", code: "SID SS", description: "Starter strip, vinyl" });
    pushLineItem(items, lineNumber++, starter, wallBottomLFArr, "LF");
  }

  if (wallAreaSQ > 0) {
    const wrap = findSidingItem({ codes: ['WP', 'HOUSE WRAP', 'HOUSEWRAP'], keywords: ['house wrap', 'housewrap', 'weather barrier'], exclude: [] }, { price: 55, unit: "SQ", code: "WP", description: "House wrap / weather barrier" });
    pushLineItem(items, lineNumber++, wrap, wallAreaSQ, "SQ");
  }

  if (wallAreaSQ > 0) {
    const nailBoxes = Math.ceil(wallAreaSQ * 0.18);
    const nails = findSidingItem({ codes: ['SID NAIL', 'NAILS'], keywords: ['siding nail', 'nail'], exclude: ['roofing'] }, { price: 45, unit: "EA", code: "SID NAIL", description: "Nails, 25-lb box (siding)" });
    pushLineItem(items, lineNumber++, nails, nailBoxes, "EA");
  }

  if (perimeterLFArr > 0) {
    const caulkQty = Math.max(2, Math.ceil(perimeterLFArr / 60));
    const caulk = findSidingItem({ codes: ['CAULK', 'SID CLK'], keywords: ['caulk', 'sealant'], exclude: [] }, { price: 8, unit: "EA", code: "CAULK", description: "Caulk, exterior grade (tube)" });
    pushLineItem(items, lineNumber++, caulk, caulkQty, "EA");
  }

  {
    const lightBox = findSidingItem({ codes: ['EL BOX', 'ELEC EXT'], keywords: ['electrical box', 'light box'], exclude: [] }, { price: 15, unit: "EA", code: "EL BOX", description: "Electrical box extension (light box)" });
    const price = Number(lightBox.price) || 0;
    items.push({ line: lineNumber++, code: lightBox.code, description: lightBox.description, quantity: 1, unit: "EA", rate: price, rcv: price, acv: price, amount: price, depreciation: 0 });
  }

  if (perimeterLFArr > 0) {
    const waterTable = findSidingItem({ codes: ['SID WT', 'WATER TABLE'], keywords: ['water table', 'utility trim'], exclude: [] }, { price: 2.50, unit: "LF", code: "SID WT", description: "Water table / utility trim" });
    pushLineItem(items, lineNumber++, waterTable, perimeterLFArr, "LF");
  }

  return items;
}

export function normalizeRoofMeasurements(obj = {}) {
  const toNum = (v) => { if (v === undefined || v === null) return 0; const n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
  const o = { ...(obj || {}) };
  const sqft = toNum(o.roof_area_sqft || o.area_sqft || o.total_area_sqft || o['Total Area (All Pitches)']);
  const sq = toNum(o.roof_area_sq || o.area_sq || o.squares || o['Squares']) || (sqft / 100);
  o.roof_area_sq = sq;
  o.roof_area_sqft = sqft || (sq * 100);
  o.ridge_lf = toNum(o.ridge_lf || o.ridges || o['Ridges'] || o.ridges_ft || o['Ridges (ft)']);
  o.hip_lf = toNum(o.hip_lf || o.hips || o['Hips'] || o.hips_ft || o['Hips (ft)']);
  o.valley_lf = toNum(o.valley_lf || o.valleys || o['Valleys'] || o.valleys_ft || o['Valleys (ft)']);
  o.rake_lf = toNum(o.rake_lf || o.rakes || o['Rakes'] || o.rakes_ft || o['Rakes (ft)']);
  o.eave_lf = toNum(o.eave_lf || o.eaves || o['Eaves'] || o.eaves_ft || o['Eaves (ft)']);
  o.step_flashing_lf = toNum(o.step_flashing_lf || o.step_flashing || o['Step flashing'] || o['Step flashing (ft)']);
  o.apron_flashing_lf = toNum(o.apron_flashing_lf || o.apron_flashing || o['Apron flashing'] || o['Apron flashing (ft)']);
  if (!o.pitch) o.pitch = o.predominant_pitch || o['Predominant Pitch'] || 'Unknown';
  return o;
}

export function applyWasteToLineItems(items, wastePercent) {
  return items.map(item => {
    const desc = (item.description || '').toLowerCase();
    const isPerUnit = item.unit === 'EA' || desc.includes('chimney') || desc.includes('pipe boot') || desc.includes('pipe jack') ||
      desc.includes('box vent') || desc.includes('roof vent') || desc.includes('satellite') || desc.includes('detach');
    const isMaterial = !isPerUnit && (desc.includes('shingle') || desc.includes('underlayment') || desc.includes('felt') ||
      desc.includes('ice & water') || desc.includes('starter') || desc.includes('drip') ||
      desc.includes('cap') || desc.includes('valley') || desc.includes('flashing') ||
      desc.includes('siding') || desc.includes('j-channel') || desc.includes('j channel') ||
      desc.includes('soffit') || desc.includes('fascia'));
    if (isMaterial && item.quantity > 0) {
      const multiplier = 1 + (wastePercent / 100);
      const newQty = Number((item.quantity * multiplier).toFixed(2));
      const rate = Number(item.rate) || 0;
      const newRcv = newQty * rate;
      return { ...item, quantity: newQty, rcv: newRcv, acv: newRcv, amount: newRcv };
    }
    return item;
  });
}

export function buildRoofLineItemsArray(measurements, priceList) {
  if ((!measurements.roof_area_sq || Number(measurements.roof_area_sq) === 0) && Number(measurements.roof_area_sqft) > 0) {
    measurements.roof_area_sq = Number(measurements.roof_area_sqft) / 100;
  }

  const items = [];
  let lineNumber = 1;
  const helperFavorites = priceList.filter(item => item.is_favorite);

  const findExactRoofItem = (searchTerms, fallback) => {
    return findItemInPriceList(priceList, searchTerms, fallback, { favoritesPriority: helperFavorites.length > 0 });
  };

  const helperCorrectedSq = Math.round((Number(measurements.corrected_area_sq) || Number(measurements.roof_area_sq) || 0) * 100) / 100;

  if (helperCorrectedSq > 0) {
    const item = findExactRoofItem({ codes: ['RFG SSSQ'], keywords: ['architectural asphalt'], exclude: ['wood', 'tile', 'metal'] },
      { price: 350, unit: "SQ", code: "RFG SSSQ", description: "Shingles, architectural asphalt" });
    pushLineItem(items, lineNumber++, item, helperCorrectedSq, "SQ");
  }

  if (helperCorrectedSq > 0) {
    const item = findExactRoofItem({ codes: ['RFG UL'], keywords: ['underlayment'], exclude: [] },
      { price: 25, unit: "SQ", code: "RFG UL", description: "Underlayment, #30 felt" });
    pushLineItem(items, lineNumber++, item, helperCorrectedSq, "SQ");
  }

  const eavesLF = Math.round((Number(measurements.eave_lf) || 0) * 100) / 100;
  const valleysLF = Math.round((Number(measurements.valley_lf) || 0) * 100) / 100;
  const totalIceWater = Math.ceil((eavesLF * 2 + valleysLF) * 1.10);
  if (totalIceWater > 0) {
    const item = findExactRoofItem({ codes: ['IWS'], keywords: ['ice & water'], exclude: [] }, { price: 2.02, unit: "LF", code: "IWS", description: "Ice & water barrier" });
    pushLineItem(items, lineNumber++, item, totalIceWater, "LF");
  }

  const rakeLF = Math.round((Number(measurements.rake_lf) || 0) * 100) / 100;
  const totalEdge = Math.round((rakeLF + eavesLF) * 100) / 100;
  if (totalEdge > 0) {
    const starter = findExactRoofItem({ codes: ['RFG STR'], keywords: ['starter'], exclude: [] }, { price: 2.5, unit: "LF", code: "RFG STR", description: "Starter strip, 3-tab asphalt" });
    pushLineItem(items, lineNumber++, starter, totalEdge, "LF");

    const drip = findExactRoofItem({ codes: ['RFG DE'], keywords: ['drip edge'], exclude: [] }, { price: 3, unit: "LF", code: "RFG DE", description: "Drip edge, metal" });
    pushLineItem(items, lineNumber++, drip, totalEdge, "LF");
  }

  const ridgeLF = Math.round((Number(measurements.ridge_lf) || 0) * 100) / 100;
  if (ridgeLF > 0) {
    const ridge = findExactRoofItem({ codes: ['RFG RDC'], keywords: ['ridge cap'], exclude: [] }, { price: 8.5, unit: "LF", code: "RFG RDC", description: "Ridge cap, architectural asphalt" });
    pushLineItem(items, lineNumber++, ridge, ridgeLF, "LF");
  }

  const hipLF = Math.round((Number(measurements.hip_lf) || 0) * 100) / 100;
  if (hipLF > 0) {
    const hip = findExactRoofItem({ codes: ['RFG HP'], keywords: ['hip cap'], exclude: [] }, { price: 8.5, unit: "LF", code: "RFG HP", description: "Hip cap, architectural asphalt" });
    pushLineItem(items, lineNumber++, hip, hipLF, "LF");
  }

  if (valleysLF > 0) {
    const valley = findExactRoofItem({ codes: ['VMTLWP'], keywords: ['valley metal'], exclude: [] }, { price: 12, unit: "LF", code: "VMTLWP", description: "Valley metal - (W) profile - painted" });
    pushLineItem(items, lineNumber++, valley, valleysLF, "LF");
  }

  const stepFlashLF = Math.round((Number(measurements.step_flashing_lf) || 0) * 100) / 100;
  if (stepFlashLF > 0) {
    const flash = findExactRoofItem({ codes: ['RFG FLS'], keywords: ['step flashing'], exclude: [] }, { price: 4.5, unit: "LF", code: "RFG FLS", description: "Step flashing, metal" });
    pushLineItem(items, lineNumber++, flash, stepFlashLF, "LF");
  }

  const apronFlashLF = Math.round((Number(measurements.apron_flashing_lf) || 0) * 100) / 100;
  if (apronFlashLF > 0) {
    const apronFlash = findExactRoofItem({ codes: ['RFG FLSA', 'APRON'], keywords: ['apron flashing', 'head wall flashing', 'headwall'], exclude: [] }, { price: 5.5, unit: "LF", code: "RFG FLSA", description: "Apron/head wall flashing, metal" });
    pushLineItem(items, lineNumber++, apronFlash, apronFlashLF, "LF");
  }

  if (helperCorrectedSq > 0) {
    const tearOff = findExactRoofItem({ codes: ['RFG R&R'], keywords: ['remove roof covering'], exclude: [] }, { price: 75, unit: "SQ", code: "RFG R&R", description: "Remove roof covering, 3-tab composition shingle" });
    pushLineItem(items, lineNumber++, tearOff, helperCorrectedSq, "SQ");
  }

  if (measurements.gutter_lf > 0) {
    const gutter = findExactRoofItem({ codes: ['RFG GTR'], keywords: ['gutter aluminum'], exclude: [] }, { price: 10.33, unit: "LF", code: "RFG GTR", description: "Gutter / downspout - aluminum - up to 5\"" });
    pushLineItem(items, lineNumber++, gutter, measurements.gutter_lf, "LF");
  }

  if (measurements.downspout_count > 0) {
    const downspout = findExactRoofItem({ codes: ['DNSPOUT'], keywords: ['downspout'], exclude: [] }, { price: 45, unit: "EA", code: "DNSPOUT", description: "Downspout - aluminum - 2\" x 3\"" });
    pushLineItem(items, lineNumber++, downspout, measurements.downspout_count, "EA");
  }

  return items;
}

export function downloadMaterialListCSV(materialListData, customerName) {
  if (!materialListData) return;

  let csv = 'MATERIALS TO PURCHASE\n\n';
  csv += `Customer: ${materialListData.estimate.customer_name}\n`;
  csv += `Address: ${materialListData.estimate.property_address}\n\n`;

  csv += 'Material,Qty to Buy,Unit,Notes\n';
  materialListData.material_calculations.forEach(item => {
    csv += `"${item.material}",${item.quantity},"${item.purchaseUnit || item.unit}","${item.notes}"\n`;
  });

  csv += `\n\nGrand Total:,$${materialListData.totals.grand_total.toFixed(2)}\n`;

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `material-list-${customerName || 'estimate'}.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}
