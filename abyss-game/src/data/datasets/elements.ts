/**
 * All 118 chemical elements ordered roughly from most to least commonly named.
 * Format: "Name|aliases ; Symbol ; group"
 *   am alkali metal · ae alkaline earth · tm transition metal · pt post-transition
 *   md metalloid · nm reactive nonmetal · hg halogen (group 17)
 *   ng noble gas (group 18) · ln lanthanide · an actinide
 */
const RAW = `
Hydrogen;H;nm
Oxygen;O;nm
Carbon;C;nm
Gold;Au;tm
Iron;Fe;tm
Helium;He;ng
Nitrogen;N;nm
Silver;Ag;tm
Copper;Cu;tm
Sodium;Na;am
Calcium;Ca;ae
Uranium;U;an
Neon;Ne;ng
Lead;Pb;pt
Aluminium|Aluminum;Al;pt
Platinum;Pt;tm
Potassium;K;am
Magnesium;Mg;ae
Zinc;Zn;tm
Mercury;Hg;tm
Chlorine;Cl;hg
Lithium;Li;am
Sulfur|Sulphur;S;nm
Plutonium;Pu;an
Titanium;Ti;tm
Tin;Sn;pt
Silicon;Si;md
Fluorine;F;hg
Phosphorus;P;nm
Nickel;Ni;tm
Iodine;I;hg
Argon;Ar;ng
Cobalt;Co;tm
Radon;Rn;ng
Tungsten|Wolfram;W;tm
Chromium;Cr;tm
Radium;Ra;ae
Xenon;Xe;ng
Krypton;Kr;ng
Bromine;Br;hg
Arsenic;As;md
Boron;B;md
Manganese;Mn;tm
Beryllium;Be;ae
Cesium|Caesium;Cs;am
Barium;Ba;ae
Strontium;Sr;ae
Palladium;Pd;tm
Bismuth;Bi;pt
Cadmium;Cd;tm
Selenium;Se;nm
Iridium;Ir;tm
Osmium;Os;tm
Rubidium;Rb;am
Francium;Fr;am
Vanadium;V;tm
Thorium;Th;an
Polonium;Po;pt
Americium;Am;an
Einsteinium;Es;an
Neptunium;Np;an
Gallium;Ga;pt
Germanium;Ge;md
Antimony;Sb;md
Tellurium;Te;md
Astatine;At;hg
Lanthanum;La;ln
Cerium;Ce;ln
Neodymium;Nd;ln
Europium;Eu;ln
Gadolinium;Gd;ln
Promethium;Pm;ln
Samarium;Sm;ln
Erbium;Er;ln
Ytterbium;Yb;ln
Yttrium;Y;tm
Zirconium;Zr;tm
Niobium;Nb;tm
Molybdenum;Mo;tm
Technetium;Tc;tm
Ruthenium;Ru;tm
Rhodium;Rh;tm
Indium;In;pt
Hafnium;Hf;tm
Tantalum;Ta;tm
Rhenium;Re;tm
Thallium;Tl;pt
Scandium;Sc;tm
Praseodymium;Pr;ln
Terbium;Tb;ln
Dysprosium;Dy;ln
Holmium;Ho;ln
Thulium;Tm;ln
Lutetium;Lu;ln
Actinium;Ac;an
Protactinium;Pa;an
Curium;Cm;an
Berkelium;Bk;an
Californium;Cf;an
Fermium;Fm;an
Mendelevium;Md;an
Nobelium;No;an
Lawrencium;Lr;an
Rutherfordium;Rf;tm
Dubnium;Db;tm
Seaborgium;Sg;tm
Bohrium;Bh;tm
Hassium;Hs;tm
Meitnerium;Mt;tm
Darmstadtium;Ds;tm
Roentgenium;Rg;tm
Copernicium;Cn;tm
Nihonium;Nh;pt
Flerovium;Fl;pt
Moscovium;Mc;pt
Livermorium;Lv;pt
Tennessine;Ts;hg
Oganesson;Og;ng
`

export interface Element {
  name: string
  aliases: string[]
  symbol: string
  group: string
}

export const ELEMENTS: Element[] = RAW.trim()
  .split('\n')
  .map((line) => {
    const [names, symbol, group] = line.split(';')
    const [name, ...aliases] = names.split('|')
    return { name, aliases, symbol, group }
  })

export const elementAnswer = (e: Element) => [e.name, ...e.aliases].join('|')
