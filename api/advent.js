// 25 Day Advent Health Calendar: returns only the doors that are open today.
// The date lock lives here (Australia/Melbourne time), so locked challenges never reach the browser.
// Needs no secrets: it only checks the visitor is signed in.

const SUPABASE_URL = 'https://jgbcgbdbmqtsozwlllfj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3AdpZhYhif9JeP3rvmY2-Q_MuhFMGiw';

const DEMO = { text: 'Tidy your bedroom today', why: 'A calmer room is an easier place to sleep. Quick to do, and you will feel it tonight.' };

const ITEMS = [
  ['Finish one full bottle of water today', 'Most of us run a little dry without noticing. This one is easy and it sets the tone.'],
  ['Join the Beast Challenge today. It’s free. Log your steps and food', 'Free to join. Log your steps and food and you will see where you really are.'],
  ['Eat one meal with at least 25g of protein today', 'Protein keeps you fuller for longer. Check the numbers once and you will start to see it everywhere.'],
  ['Tonight, charge your phone outside your bedroom', 'Better sleep starts with the phone not being within reach.'],
  ['Make one recipe from the Beast Coach recipes page today', 'Pick one, cook it, see how it feels. The recipes page has the macros done for you.'],
  ['Walk somewhere you would normally drive, or take the long way on foot', 'Free steps, and a chance to clear your head.'],
  ['Pick the hardest task on your list and do it before anything else', 'The dread is usually worse than the task. Get it done and the rest of the day is lighter.'],
  ['At your next meal, eat the protein on your plate first', 'A small change in order. You will probably notice you feel full sooner.'],
  ['Read the label on a food you eat all the time but have never read the label of. Check the serving size and the first three ingredients', 'You might be surprised. You might not. Either way you will know.'],
  ['Put your screens away 30 minutes before bed tonight', 'Give your head half an hour to switch off before sleep.'],
  ['Message a friend you have not spoken to in a while', 'Connection is part of health too. It only takes a minute.'],
  ['Go for a walk with someone today, phones away', 'A walk with no screens turns into a proper conversation.'],
  ['Move one food that always derails you somewhere harder to reach, or give it to someone', 'Make the easy choice the better one. No rules, just a bit of friction.'],
  ['Tonight, set tomorrow’s alarm and put your phone across the room so you have to get up', 'Setting up tomorrow tonight takes the decision out of the morning.'],
  ['Beat yesterday’s step count by 1,000 today', 'About ten more minutes of walking. Check your steps yesterday and aim just past them.'],
  ['Write down everything you eat today, no judging it. Skip this one if tracking food isn’t good for you', 'Just noticing is the point. There is no good or bad here. If tracking food doesn’t suit you, skip today with no guilt.'],
  ['Do 5 minutes of slow breathing today: in for 4, out for 6', 'Longer out than in tells your body to settle down. Set a timer and just do the five minutes.'],
  ['Say no to one small thing you would normally say yes to', 'Saying no to something small is practice for the bigger ones.'],
  ['Eat one food you have never tried before', 'Variety is good for you and it makes eating more interesting.'],
  ['Take a photo of a meal and a photo from your walk today', 'A small record of a good day. You will be glad to have them later.'],
  ['Walk for 10 minutes after your biggest meal today', 'A short walk after eating helps your body handle the meal. It also counts toward your steps.'],
  ['Write down one thing you are worried about and one small thing you can do about it', 'Getting it out of your head and onto paper makes it smaller.'],
  ['Do one kind thing for someone and do not mention it', 'No credit needed. It still does you good.'],
  ['Look back over the month and pick the one challenge you will keep. Write it down', 'You do not need 25 habits. You need one that sticks.'],
  ['Christmas Day: enjoy it, and walk after the big meal. No guilt', 'Eat, enjoy it, go for a walk afterwards. That is the whole challenge.']
];

// Which door number is open right now, in Melbourne time. 0 = before 1 December 2026, 25 = all open.
function openDoors(asOf) {
  let y, m, d;
  if (asOf) { [y, m, d] = asOf.split('-').map(Number); }
  else {
    const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    y = get('year'); m = get('month'); d = get('day');
  }
  if (y < 2026 || (y === 2026 && m < 12)) return 0;
  if (y === 2026 && m === 12) return Math.min(d, 25);
  return 25;
}

async function signedIn(token) {
  if (!token) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    return r.ok;
  } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!(await signedIn(token))) return res.status(401).json({ error: 'sign_in' });

  // Preview deployments only: ?asOf=2026-12-09 lets us test other dates. Ignored on the live site.
  const q = req.query && req.query.asOf;
  const asOf = process.env.VERCEL_ENV !== 'production' && /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : null;

  const today = openDoors(asOf);
  const days = ITEMS.slice(0, today).map((it, i) => ({ day: i + 1, text: it[0], why: it[1] }));
  return res.status(200).json({ today, demo: DEMO, days, preview: !!asOf });
};

module.exports._test = { openDoors, ITEMS };
