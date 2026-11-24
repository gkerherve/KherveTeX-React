// The periodic table: symbol, name, standard atomic mass and family, for
// Science ▸ Element tile, Bohr model and nuclear notation. Pure data.

export type Family = 'nonmetal' | 'noble' | 'alkali' | 'alkaline' | 'transition' | 'post' | 'metalloid' | 'halogen' | 'lanthanide' | 'actinide'

const RAW = `H,Hydrogen,1.008,nm|He,Helium,4.0026,ng|Li,Lithium,6.94,al|Be,Beryllium,9.0122,ae|B,Boron,10.81,md|C,Carbon,12.011,nm|N,Nitrogen,14.007,nm|O,Oxygen,15.999,nm|F,Fluorine,18.998,ha|Ne,Neon,20.180,ng|`
  + `Na,Sodium,22.990,al|Mg,Magnesium,24.305,ae|Al,Aluminium,26.982,pt|Si,Silicon,28.085,md|P,Phosphorus,30.974,nm|S,Sulfur,32.06,nm|Cl,Chlorine,35.45,ha|Ar,Argon,39.948,ng|`
  + `K,Potassium,39.098,al|Ca,Calcium,40.078,ae|Sc,Scandium,44.956,tm|Ti,Titanium,47.867,tm|V,Vanadium,50.942,tm|Cr,Chromium,51.996,tm|Mn,Manganese,54.938,tm|Fe,Iron,55.845,tm|Co,Cobalt,58.933,tm|Ni,Nickel,58.693,tm|Cu,Copper,63.546,tm|Zn,Zinc,65.38,tm|Ga,Gallium,69.723,pt|Ge,Germanium,72.630,md|As,Arsenic,74.922,md|Se,Selenium,78.971,nm|Br,Bromine,79.904,ha|Kr,Krypton,83.798,ng|`
  + `Rb,Rubidium,85.468,al|Sr,Strontium,87.62,ae|Y,Yttrium,88.906,tm|Zr,Zirconium,91.224,tm|Nb,Niobium,92.906,tm|Mo,Molybdenum,95.95,tm|Tc,Technetium,98,tm|Ru,Ruthenium,101.07,tm|Rh,Rhodium,102.91,tm|Pd,Palladium,106.42,tm|Ag,Silver,107.87,tm|Cd,Cadmium,112.41,tm|In,Indium,114.82,pt|Sn,Tin,118.71,pt|Sb,Antimony,121.76,md|Te,Tellurium,127.60,md|I,Iodine,126.90,ha|Xe,Xenon,131.29,ng|`
  + `Cs,Caesium,132.91,al|Ba,Barium,137.33,ae|La,Lanthanum,138.91,la|Ce,Cerium,140.12,la|Pr,Praseodymium,140.91,la|Nd,Neodymium,144.24,la|Pm,Promethium,145,la|Sm,Samarium,150.36,la|Eu,Europium,151.96,la|Gd,Gadolinium,157.25,la|Tb,Terbium,158.93,la|Dy,Dysprosium,162.50,la|Ho,Holmium,164.93,la|Er,Erbium,167.26,la|Tm,Thulium,168.93,la|Yb,Ytterbium,173.05,la|Lu,Lutetium,174.97,la|`
  + `Hf,Hafnium,178.49,tm|Ta,Tantalum,180.95,tm|W,Tungsten,183.84,tm|Re,Rhenium,186.21,tm|Os,Osmium,190.23,tm|Ir,Iridium,192.22,tm|Pt,Platinum,195.08,tm|Au,Gold,196.97,tm|Hg,Mercury,200.59,tm|Tl,Thallium,204.38,pt|Pb,Lead,207.2,pt|Bi,Bismuth,208.98,pt|Po,Polonium,209,pt|At,Astatine,210,ha|Rn,Radon,222,ng|`
  + `Fr,Francium,223,al|Ra,Radium,226,ae|Ac,Actinium,227,ac|Th,Thorium,232.04,ac|Pa,Protactinium,231.04,ac|U,Uranium,238.03,ac|Np,Neptunium,237,ac|Pu,Plutonium,244,ac|Am,Americium,243,ac|Cm,Curium,247,ac|Bk,Berkelium,247,ac|Cf,Californium,251,ac|Es,Einsteinium,252,ac|Fm,Fermium,257,ac|Md,Mendelevium,258,ac|No,Nobelium,259,ac|Lr,Lawrencium,266,ac|`
  + `Rf,Rutherfordium,267,tm|Db,Dubnium,268,tm|Sg,Seaborgium,269,tm|Bh,Bohrium,270,tm|Hs,Hassium,277,tm|Mt,Meitnerium,278,tm|Ds,Darmstadtium,281,tm|Rg,Roentgenium,282,tm|Cn,Copernicium,285,tm|Nh,Nihonium,286,pt|Fl,Flerovium,289,pt|Mc,Moscovium,290,pt|Lv,Livermorium,293,pt|Ts,Tennessine,294,ha|Og,Oganesson,294,ng`

const FAM: Record<string, Family> = { nm: 'nonmetal', ng: 'noble', al: 'alkali', ae: 'alkaline', tm: 'transition', pt: 'post', md: 'metalloid', ha: 'halogen', la: 'lanthanide', ac: 'actinide' }

export interface Element { z: number; symbol: string; name: string; mass: string; family: Family }

export const ELEMENTS: Element[] = RAW.split('|').map((e, i) => {
  const [symbol, name, mass, f] = e.split(',')
  return { z: i + 1, symbol, name, mass, family: FAM[f] }
})

export const FAMILY_COLORS: Record<Family, string> = {
  nonmetal: '2E7D32', noble: '6A1B9A', alkali: 'C62828', alkaline: 'E65100', transition: '1F6FB5',
  post: '00838F', metalloid: '827717', halogen: 'AD1457', lanthanide: '5D4037', actinide: '37474F',
}

export function element(q: string | number): Element | null {
  if (typeof q === 'number') return ELEMENTS[q - 1] ?? null
  const t = q.trim().toLowerCase()
  return ELEMENTS.find(e => e.symbol.toLowerCase() === t || e.name.toLowerCase() === t) ?? (Number(t) ? ELEMENTS[Number(t) - 1] ?? null : null)
}

// Electrons per shell, by the Madelung (aufbau) order. A few transition
// metals differ by one electron (Cr, Cu...), as in most school tables.
export function shells(z: number): number[] {
  const order: [number, number][] = [[1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0], [3, 2], [4, 1], [5, 0], [4, 2], [5, 1], [6, 0], [4, 3], [5, 2], [6, 1], [7, 0], [5, 3], [6, 2], [7, 1]]
  const out: number[] = []
  let left = z
  for (const [n, l] of order) {
    if (left <= 0) break
    const k = Math.min(left, 2 * (2 * l + 1))
    out[n - 1] = (out[n - 1] ?? 0) + k
    left -= k
  }
  return Array.from({ length: out.length }, (_, i) => out[i] ?? 0)
}
