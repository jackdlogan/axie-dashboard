// Derives a single "collectible collection" label for an Axie from its
// collection-identifying fields. An Axie can belong to more than one (e.g. an
// Origin with mystic parts), so this picks the most notable in priority order
// and returns '' for a regular (non-collectible) Axie.
//
// Inputs come straight from the Sky Mavis `axie`/`axies` query:
//   { numMystic, numJapan, numXmas, title, parts: [{ specialGenes }] }
// Nightmare / Summer / Shiny have no num* field on the Axie type, so they're
// detected via parts.specialGenes tags ("Nightmare", "Summer2022", …). Origin
// and MEO have no special parts and are detected via `title`.
export function collectibleLabel(axie = {}) {
  const { numMystic, numJapan, numXmas, title } = axie
  const tags = new Set((axie.parts || []).map((p) => p?.specialGenes).filter(Boolean))
  const has = (sub) => [...tags].some((t) => t.toLowerCase().includes(sub))

  if ((numMystic || 0) > 0 || tags.has('Mystic')) return 'Mystic'
  if (title === 'Origin') return 'Origin'
  if (typeof title === 'string' && title.startsWith('MEO')) return 'MEO'
  // Shiny outranks the part-based collections, so a NightmareShiny / SummerShiny
  // is labelled Shiny (its rarer designation).
  if (has('shiny')) return 'Shiny'
  if (has('nightmare')) return 'Nightmare'
  if (has('summer')) return 'Summer'
  if ((numJapan || 0) > 0 || has('japan')) return 'Japanese'
  if ((numXmas || 0) > 0 || has('xmas')) return 'Christmas'
  return ''
}
