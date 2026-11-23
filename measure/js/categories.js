// Built-in work categories (from the Pune measurement sheet) – each knows its unit and what to measure.
// measure: 'LxH' = length × height (walls, partitions, cladding) · 'LxW' = length × width (floors, ceilings)
//          'L' = running length (Rft) · 'M' = running metres (cables) · 'N' = count
export const CATEGORIES = [
  { group: 'Civil & flooring', items: [
    ['PCC', 'Sqft', 'LxW'], ['Tile laying', 'Sqft', 'LxW'], ['Tile skirting', 'Rft', 'L'], ['Granite', 'Sqft', 'LxW'],
    ['Brass inlay / patti', 'Rft', 'L'], ['Floor protection', 'Sqft', 'LxW'], ['Deep cleaning', 'Sqft', 'LxW'],
    ['Carpet installation', 'Sqft', 'LxW'], ['Debris removal', 'Nos', 'N'], ['Granite waterjet cutting', 'Nos', 'N'] ] },
  { group: 'Partitions & carpentry', items: [
    ['Gypsum partition / cladding', 'Sqft', 'LxH'], ['GI framing', 'Sqft', 'LxH'], ['Aluminium framework', 'Sqft', 'LxH'],
    ['Plywood cladding (FR)', 'Sqft', 'LxH'], ['Bison board cladding', 'Sqft', 'LxH'], ['MDF panelling', 'Sqft', 'LxH'],
    ['Laminate', 'Sqft', 'LxH'], ['Curtain pelmet', 'Rft', 'L'], ['Storage racks', 'Nos', 'N'], ['Beading / patti', 'Rft', 'L'] ] },
  { group: 'Ceiling', items: [
    ['Gypsum false ceiling (flat)', 'Sqft', 'LxW'], ['Ceiling cove / bulkhead / curve', 'Rft', 'L'], ['Grid ceiling', 'Sqft', 'LxW'],
    ['Modular trap door', 'Nos', 'N'] ] },
  { group: 'Painting', items: [
    ['Wall painting', 'Sqft', 'LxH'], ['Ceiling painting', 'Sqft', 'LxW'], ['Duco painting', 'Sqft', 'LxH'],
    ['Texture paint', 'Sqft', 'LxH'], ['Cove paint (running)', 'Rft', 'L'] ] },
  { group: 'Facade & glass', items: [
    ['Facade aluminium framework', 'Sqft', 'LxH'], ['Facade ply', 'Sqft', 'LxH'], ['Facade stone laminate', 'Sqft', 'LxH'],
    ['Facade glass', 'Sqft', 'LxH'], ['ACP skirting', 'Rft', 'L'], ['Brass / SS L-angle', 'Rft', 'L'] ] },
  { group: 'Shutter & doors', items: [
    ['Rolling shutter', 'Sqft', 'LxH'], ['Folding / sliding shutter', 'Sqft', 'LxH'], ['Door', 'Nos', 'N'] ] },
  { group: 'Electrical', items: [
    ['Electrical points', 'Nos', 'N'], ['Cable', 'Mtr', 'M'], ['LED strip light', 'Mtr', 'M'], ['Flexible pipe / conduit', 'Mtr', 'M'],
    ['Light fittings', 'Nos', 'N'] ] },
  { group: 'Fire (FAS / sprinkler)', items: [
    ['FAS cable', 'Mtr', 'M'], ['Sprinkler heads', 'Nos', 'N'], ['Fire extinguisher', 'Nos', 'N'] ] },
  { group: 'Others', items: [
    ['Scaffolding', 'Sqft', 'LxH'], ['Polythene cover', 'Sqft', 'LxW'], ['Miscellaneous', 'Nos', 'N'] ] },
];
export const findCat = name => { for (const g of CATEGORIES) for (const it of g.items) if (it[0] === name) return { group: g.group, name: it[0], unit: it[1], measure: it[2] }; return null; };
export const catOptions = (sel) => CATEGORIES.map(g => `<optgroup label="${g.group}">${g.items.map(it => `<option ${it[0] === sel ? 'selected' : ''}>${it[0]}</option>`).join('')}</optgroup>`).join('') + `<option value="__other" ${sel === '__other' ? 'selected' : ''}>Other (type heading)</option>`;
export const MEASURE_HINT = {
  LxH: 'Length along the wall × height (floor to top). Minus doors/windows with a minus line.',
  LxW: 'Length × width of the area (floor or ceiling). Minus columns/cut-outs with a minus line.',
  L: 'Running length only (Rft).',
  M: 'Running length in metres.',
  N: 'Count only.',
};
