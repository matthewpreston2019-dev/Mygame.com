/**
 * Sovereign states (plus a few widely recognised territories with partial
 * recognition), ordered roughly from most to least commonly named.
 *
 * Format: "Name|aliases ; continents ; Capital|aliases ; flags"
 *   continents: AF AS EU NA SA OC (several separated by "/")
 *   flags: L = landlocked, E = European Union member
 */
const RAW = `
United States|USA|US|U.S.A.|U.S.|America|United States of America;NA;Washington, D.C.|Washington|Washington DC;
China|People's Republic of China|PRC;AS;Beijing|Peking;
France;EU;Paris;E
Germany|Deutschland;EU;Berlin;E
Japan;AS;Tokyo;
Brazil|Brasil;SA;Brasília|Brasilia;
Canada;NA;Ottawa;
Italy|Italia;EU;Rome|Roma;E
Spain|España;EU;Madrid;E
United Kingdom|UK|Great Britain|Britain|U.K.;EU;London;
Russia|Russian Federation;EU/AS;Moscow;
India;AS;New Delhi|Delhi;
Australia;OC;Canberra;
Mexico|México;NA;Mexico City|Ciudad de México|CDMX;
Egypt;AF;Cairo;
Argentina;SA;Buenos Aires;
South Africa;AF;Pretoria|Cape Town|Bloemfontein;
Nigeria;AF;Abuja;
Kenya;AF;Nairobi;
Ireland|Republic of Ireland|Éire;EU;Dublin;E
Portugal;EU;Lisbon|Lisboa;E
Greece|Hellas;EU;Athens;E
Netherlands|Holland|The Netherlands;EU;Amsterdam;E
Sweden;EU;Stockholm;E
Norway;EU;Oslo;
Poland;EU;Warsaw|Warszawa;E
South Korea|Korea|Republic of Korea;AS;Seoul;
North Korea|DPRK;AS;Pyongyang;
Switzerland;EU;Bern|Berne;L
Belgium;EU;Brussels;E
Austria;EU;Vienna|Wien;LE
Denmark;EU;Copenhagen;E
Finland;EU;Helsinki;E
Turkey|Türkiye|Turkiye;AS/EU;Ankara;
Thailand;AS;Bangkok;
Vietnam|Viet Nam;AS;Hanoi;
Indonesia;AS;Jakarta;
Philippines;AS;Manila;
Pakistan;AS;Islamabad;
Iran;AS;Tehran;
Iraq;AS;Baghdad;
Israel;AS;Jerusalem;
Saudi Arabia;AS;Riyadh;
Afghanistan;AS;Kabul;L
Colombia;SA;Bogotá|Bogota;
Peru;SA;Lima;
Chile;SA;Santiago;
Venezuela;SA;Caracas;
Cuba;NA;Havana;
Jamaica;NA;Kingston;
New Zealand|Aotearoa;OC;Wellington;
Morocco;AF;Rabat;
Ethiopia;AF;Addis Ababa;L
Ghana;AF;Accra;
Ukraine;EU;Kyiv|Kiev;
Iceland;EU;Reykjavík|Reykjavik;
Hungary;EU;Budapest;LE
Czech Republic|Czechia;EU;Prague;LE
Romania;EU;Bucharest;E
Bulgaria;EU;Sofia;E
Croatia;EU;Zagreb;E
Serbia;EU;Belgrade;L
Malaysia;AS;Kuala Lumpur|Putrajaya;
Singapore;AS;Singapore;
Nepal;AS;Kathmandu;L
Bangladesh;AS;Dhaka;
Sri Lanka;AS;Sri Jayawardenepura Kotte|Colombo|Kotte;
Mongolia;AS;Ulaanbaatar|Ulan Bator;L
Ecuador;SA;Quito;
Bolivia;SA;Sucre|La Paz;L
Uruguay;SA;Montevideo;
Paraguay;SA;Asunción|Asuncion;L
Algeria;AF;Algiers;
Tunisia;AF;Tunis;
Libya;AF;Tripoli;
Sudan;AF;Khartoum;
Somalia;AF;Mogadishu;
Tanzania;AF;Dodoma;
Uganda;AF;Kampala;L
Zimbabwe;AF;Harare;L
Madagascar;AF;Antananarivo;
Senegal;AF;Dakar;
Cameroon;AF;Yaoundé|Yaounde;
Democratic Republic of the Congo|DR Congo|DRC|Congo-Kinshasa|Zaire;AF;Kinshasa;
Republic of the Congo|Congo|Congo-Brazzaville;AF;Brazzaville;
Angola;AF;Luanda;
Rwanda;AF;Kigali;L
Zambia;AF;Lusaka;L
Botswana;AF;Gaborone;L
Namibia;AF;Windhoek;
Mozambique;AF;Maputo;
Ivory Coast|Côte d'Ivoire|Cote d'Ivoire;AF;Yamoussoukro|Abidjan;
Mali;AF;Bamako;L
Niger;AF;Niamey;L
Chad;AF;N'Djamena|Ndjamena;L
Haiti;NA;Port-au-Prince;
Dominican Republic;NA;Santo Domingo;
Panama;NA;Panama City;
Costa Rica;NA;San José|San Jose;
Guatemala;NA;Guatemala City;
Honduras;NA;Tegucigalpa;
Nicaragua;NA;Managua;
El Salvador;NA;San Salvador;
Belize;NA;Belmopan;
Bahamas|The Bahamas;NA;Nassau;
Trinidad and Tobago|Trinidad;NA;Port of Spain;
Barbados;NA;Bridgetown;
Guyana;SA;Georgetown;
Suriname;SA;Paramaribo;
Fiji;OC;Suva;
Papua New Guinea|PNG;OC;Port Moresby;
Samoa;OC;Apia;
Tonga;OC;Nukuʻalofa|Nukualofa;
Syria;AS;Damascus;
Lebanon;AS;Beirut;
Jordan;AS;Amman;
Kuwait;AS;Kuwait City;
Qatar;AS;Doha;
United Arab Emirates|UAE|Emirates;AS;Abu Dhabi;
Oman;AS;Muscat;
Yemen;AS;Sanaa|Sana'a;
Bahrain;AS;Manama;
Kazakhstan;AS/EU;Astana|Nur-Sultan;L
Uzbekistan;AS;Tashkent;L
Turkmenistan;AS;Ashgabat;L
Kyrgyzstan;AS;Bishkek;L
Tajikistan;AS;Dushanbe;L
Georgia;AS/EU;Tbilisi;
Armenia;AS/EU;Yerevan;L
Azerbaijan;AS/EU;Baku;L
Cambodia;AS;Phnom Penh;
Laos;AS;Vientiane;L
Myanmar|Burma;AS;Naypyidaw|Nay Pyi Taw;
Taiwan;AS;Taipei;
Bhutan;AS;Thimphu;L
Maldives;AS;Malé|Male;
Brunei;AS;Bandar Seri Begawan;
East Timor|Timor-Leste;AS;Dili;
Belarus;EU;Minsk;L
Lithuania;EU;Vilnius;E
Latvia;EU;Riga;E
Estonia;EU;Tallinn;E
Slovakia;EU;Bratislava;LE
Slovenia;EU;Ljubljana;E
Bosnia and Herzegovina|Bosnia;EU;Sarajevo;
Montenegro;EU;Podgorica;
Albania;EU;Tirana;
North Macedonia|Macedonia;EU;Skopje;L
Moldova;EU;Chișinău|Chisinau;L
Luxembourg;EU;Luxembourg;LE
Monaco;EU;Monaco;
Liechtenstein;EU;Vaduz;L
Andorra;EU;Andorra la Vella;L
San Marino;EU;San Marino;L
Vatican City|Vatican|Holy See;EU;Vatican City;L
Malta;EU;Valletta;E
Cyprus;EU/AS;Nicosia;E
Kosovo;EU;Pristina;L
Palestine;AS;;
Eritrea;AF;Asmara;
Djibouti;AF;Djibouti;
South Sudan;AF;Juba;L
Central African Republic|CAR;AF;Bangui;L
Gabon;AF;Libreville;
Equatorial Guinea;AF;Malabo;
Benin;AF;Porto-Novo|Cotonou;
Togo;AF;Lomé|Lome;
Burkina Faso;AF;Ouagadougou;L
Sierra Leone;AF;Freetown;
Liberia;AF;Monrovia;
Guinea;AF;Conakry;
Guinea-Bissau;AF;Bissau;
Gambia|The Gambia;AF;Banjul;
Mauritania;AF;Nouakchott;
Malawi;AF;Lilongwe;L
Lesotho;AF;Maseru;L
Eswatini|Swaziland;AF;Mbabane|Lobamba;L
Burundi;AF;Gitega;L
Mauritius;AF;Port Louis;
Seychelles;AF;Victoria;
Cape Verde|Cabo Verde;AF;Praia;
Comoros;AF;Moroni;
São Tomé and Príncipe|Sao Tome and Principe;AF;São Tomé|Sao Tome;
Grenada;NA;St. George's|Saint George's;
Saint Lucia|St Lucia;NA;Castries;
Dominica;NA;Roseau;
Antigua and Barbuda;NA;St. John's|Saint John's;
Saint Vincent and the Grenadines|St Vincent;NA;Kingstown;
Saint Kitts and Nevis|St Kitts and Nevis;NA;Basseterre;
Solomon Islands;OC;Honiara;
Vanuatu;OC;Port Vila;
Kiribati;OC;Tarawa|South Tarawa;
Micronesia|Federated States of Micronesia;OC;Palikir;
Marshall Islands;OC;Majuro;
Palau;OC;Ngerulmud;
Tuvalu;OC;Funafuti;
Nauru;OC;Yaren;
`

export interface Country {
  name: string
  aliases: string[]
  continents: string[]
  capital: string
  capitalAliases: string[]
  landlocked: boolean
  eu: boolean
}

export const COUNTRIES: Country[] = RAW.trim()
  .split('\n')
  .map((line) => line.split(';'))
  .map(([names, conts, caps, flags = '']) => {
    const [name, ...aliases] = names.split('|')
    const [capital, ...capitalAliases] = caps.split('|')
    return {
      name,
      aliases,
      continents: conts.split('/'),
      capital,
      capitalAliases,
      landlocked: flags.includes('L'),
      eu: flags.includes('E'),
    }
  })

export const countryAnswer = (c: Country) => [c.name, ...c.aliases].join('|')
export const capitalAnswer = (c: Country) => [c.capital, ...c.capitalAliases].join('|')
