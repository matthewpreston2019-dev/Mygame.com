/**
 * US states ordered roughly from most to least commonly named.
 * Format: "Name|aliases ; Capital ; flags"
 *   C = borders Canada (incl. via the Great Lakes), M = borders Mexico,
 *   O = one of the original 13 colonies, P = Pacific coastline,
 *   G = borders one of the Great Lakes
 */
const RAW = `
California;Sacramento;MP
Texas;Austin;M
Florida;Tallahassee;
New York;Albany;COG
Hawaii;Honolulu;P
Alaska;Juneau;CP
Washington|Washington State;Olympia;CP
Nevada;Carson City;
Arizona;Phoenix;M
Colorado;Denver;
Illinois;Springfield;G
Georgia;Atlanta;O
Ohio;Columbus;CG
Michigan;Lansing;CG
Pennsylvania;Harrisburg;COG
Massachusetts;Boston;O
New Jersey;Trenton;O
Oregon;Salem;P
Louisiana;Baton Rouge;
Tennessee;Nashville;
North Carolina;Raleigh;O
Virginia;Richmond;O
Utah;Salt Lake City;
Kentucky;Frankfort;
Alabama;Montgomery;
Mississippi;Jackson;
Montana;Helena;C
Oklahoma;Oklahoma City;
Kansas;Topeka;
Minnesota;Saint Paul|St Paul;CG
Wisconsin;Madison;G
Missouri;Jefferson City;
Indiana;Indianapolis;G
Iowa;Des Moines;
South Carolina;Columbia;O
Maryland;Annapolis;O
Connecticut;Hartford;O
Maine;Augusta;C
Vermont;Montpelier;C
New Mexico;Santa Fe;M
Idaho;Boise;C
Wyoming;Cheyenne;
Nebraska;Lincoln;
Arkansas;Little Rock;
West Virginia;Charleston;
North Dakota;Bismarck;C
South Dakota;Pierre;
New Hampshire;Concord;CO
Rhode Island;Providence;O
Delaware;Dover;O
`

export interface UsState {
  name: string
  aliases: string[]
  capital: string
  flags: string
}

export const US_STATES: UsState[] = RAW.trim()
  .split('\n')
  .map((line) => {
    const [names, capital, flags = ''] = line.split(';')
    const [name, ...aliases] = names.split('|')
    return { name, aliases, capital, flags }
  })

export const stateAnswer = (s: UsState) => [s.name, ...s.aliases].join('|')
