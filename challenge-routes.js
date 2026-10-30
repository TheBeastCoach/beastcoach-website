// Beast Challenge routes. One source of truth for /beast-challenge and /30-day-challenge.
//
// To add a route, add a line to the right region: ["Region", "Start → End", km].
// Keep each region's routes together, shortest first. Distances are rounded, typical road distances.
// Route names are saved on each member's profile, so never rename a route that people may already be on.

const STEP_GOAL = 10000, M_PER_STEP = 0.8;                      // 10,000 steps is about 8 km
const ROUTE_DAY_KM = STEP_GOAL * M_PER_STEP / 1000;             // km covered in one day at the step goal
const ROUTE_MONTH_KM = ROUTE_DAY_KM * 30;                       // km covered in the 30 day challenge

const ROUTES = [
  // Australia
  ["Australia", "Brisbane → Byron Bay", 165],
  ["Australia", "Sydney → Jervis Bay", 200],
  ["Australia", "Hobart → Launceston", 200],
  ["Australia", "Canberra → Thredbo", 210],
  ["Australia", "Melbourne → Wilsons Promontory", 220],
  ["Australia", "Larapinta Trail (NT)", 223],
  ["Australia", "Gold Coast → Noosa", 230],
  ["Australia", "Torquay → Warrnambool (Great Ocean Road)", 250],
  ["Australia", "Melbourne → Halls Gap (Grampians)", 260],
  ["Australia", "Sydney → Mudgee", 265],
  ["Australia", "Adelaide → Clare Valley and back", 270],
  ["Australia", "Perth → Margaret River", 270],
  ["Australia", "Sydney → Canberra", 285],
  ["Australia", "Brisbane → Hervey Bay", 290],
  ["Australia", "Melbourne → Lakes Entrance", 315],
  ["Australia", "Perth → Albany", 410],
  ["Australia", "Melbourne → Canberra", 660],
  ["Australia", "Adelaide → Melbourne", 730],
  ["Australia", "Sydney → Melbourne", 880],
  ["Australia", "Brisbane → Sydney", 940],

  // United States
  ["US", "New York → Philadelphia", 150],
  ["US", "Chicago → Milwaukee", 150],
  ["US", "Las Vegas → Grand Canyon Skywalk", 200],
  ["US", "Los Angeles → San Diego", 200],
  ["US", "Washington DC → Philadelphia", 225],
  ["US", "Miami → Key West", 260],
  ["US", "Austin → Houston", 265],
  ["US", "Seattle → Portland", 280],
  ["US", "San Francisco → Yosemite Valley", 305],
  ["US", "New York → Boston", 345],
  ["US", "New York → Washington DC", 365],
  ["US", "Los Angeles → Las Vegas", 435],
  ["US", "Chicago → Detroit", 450],
  ["US", "San Francisco → Los Angeles", 615],
  ["US", "New York → Chicago", 1270],

  // South Africa
  ["South Africa", "Johannesburg → Pretoria", 55],
  ["South Africa", "Durban → Pietermaritzburg", 80],
  ["South Africa", "Cape Town → Hermanus", 115],
  ["South Africa", "Johannesburg → Sun City", 165],
  ["South Africa", "Cape Town → Cape Agulhas", 220],
  ["South Africa", "Johannesburg → Bloemfontein", 400],
  ["South Africa", "Cape Town → Knysna", 490],
  ["South Africa", "Johannesburg → Durban", 570],
  ["South Africa", "Durban → East London", 670],
  ["South Africa", "Cape Town → Gqeberha", 750],
  ["South Africa", "Johannesburg → Cape Town", 1400],
  ["South Africa", "Durban → Cape Town", 1750],

  // United Kingdom
  ["UK", "London → Brighton", 85],
  ["UK", "London → Bath", 185],
  ["UK", "London → Birmingham", 190],
  ["UK", "Cardiff → London", 240],
  ["UK", "Edinburgh → Inverness", 250],
  ["UK", "Manchester → London", 325],
  ["UK", "London → Edinburgh", 650],
  ["UK", "Land's End → John o' Groats", 1400],

  // Canada
  ["Canada", "Vancouver → Whistler", 125],
  ["Canada", "Calgary → Banff", 130],
  ["Canada", "Montreal → Ottawa", 200],
  ["Canada", "Montreal → Quebec City", 250],
  ["Canada", "Toronto → Niagara Falls and back", 260],
  ["Canada", "Calgary → Edmonton", 300],
  ["Canada", "Edmonton → Jasper", 365],
  ["Canada", "Vancouver → Kelowna", 390],
  ["Canada", "Toronto → Ottawa", 450],
  ["Canada", "Toronto → Montreal", 540],
  ["Canada", "Toronto → Quebec City", 800],
  ["Canada", "Vancouver → Banff", 850],
  ["Canada", "Calgary → Vancouver", 975]
];

const ROUTE_REGIONS = ["Australia", "US", "South Africa", "UK", "Canada"];

// The route pre-selected for a new member in each region: one they can realistically finish in 30 days.
const DEFAULT_ROUTE = {
  "Australia": "Melbourne → Wilsons Promontory",
  "US": "Los Angeles → San Diego",
  "South Africa": "Cape Town → Cape Agulhas",
  "UK": "London → Bath",
  "Canada": "Montreal → Ottawa"
};
function defaultRoute(region) {
  const i = ROUTES.findIndex(r => r[1] === DEFAULT_ROUTE[region]);
  return i < 0 ? Math.max(0, ROUTES.findIndex(r => r[0] === region)) : i;
}

// Honest one-liner for how far a route gets you at 10,000 steps a day.
function routeHint(km) {
  if (km <= ROUTE_MONTH_KM) return "Finish in about " + Math.ceil(km / ROUTE_DAY_KM) + " days";
  const pct = Math.round(ROUTE_MONTH_KM / km * 100);
  return (km <= 420 ? "Stretch goal: about " : "Epic journey: about ") + pct + "% in 30 days";
}

// Routes shown as examples on the intro screens.
const FEATURED_ROUTES = ["Sydney → Melbourne", "Adelaide → Melbourne", "Melbourne → Wilsons Promontory"];
