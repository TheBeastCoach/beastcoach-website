-- Recipe ratings and recipe ideas: stop anyone reading or changing other people's rows.
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again.
--
-- What changes:
--   * Signed-in people see, add and change only their own rating (matched on their email).
--   * Nobody can read other people's ratings or emails. Everyone, signed in or not, gets the
--     average, the count and (if signed in) their own rating from recipe_rating_summary().
--   * Recipe ideas can only be submitted under the signed-in person's own email.
--
-- Column names are the ones the dashboard uses: recipe_ratings(recipe_id, email, rating) and
-- recipe_ideas(email, idea). This file does not change any columns.

-- 1. Remove every policy on the two tables now. Their current names are not in the repo, so find them.
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
            where schemaname = 'public' and tablename in ('recipe_ratings', 'recipe_ideas')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.recipe_ratings enable row level security;
alter table public.recipe_ideas   enable row level security;

-- 2. Ratings: a signed-in person reads, adds and changes only their own row. No delete policy, so no deletes.
create policy "ratings: read own" on public.recipe_ratings
  for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

create policy "ratings: add own" on public.recipe_ratings
  for insert to authenticated
  with check (email = lower(auth.jwt() ->> 'email'));

create policy "ratings: change own" on public.recipe_ratings
  for update to authenticated
  using (email = lower(auth.jwt() ->> 'email'))
  with check (email = lower(auth.jwt() ->> 'email'));

-- 3. Ideas: only ever submitted under your own email. Nobody reads the table through the website.
create policy "ideas: submit own" on public.recipe_ideas
  for insert to authenticated
  with check (email = lower(auth.jwt() ->> 'email'));

-- 4. The public summary. Returns the average, the count and the caller's own rating. Never an email.
--    Runs as the table owner so it can count everyone's ratings; the email match is done inside.
create or replace function public.recipe_rating_summary(p_recipe_id text)
returns table (avg_rating numeric, rating_count int, my_rating numeric)
language sql
stable
security definer
set search_path = public
as $$
  select round(avg(r.rating)::numeric, 2),
         count(*)::int,
         (select mine.rating::numeric
            from public.recipe_ratings mine
           where mine.recipe_id::text = p_recipe_id
             and mine.email = lower(auth.jwt() ->> 'email')
           limit 1)
    from public.recipe_ratings r
   where r.recipe_id::text = p_recipe_id;
$$;

revoke all on function public.recipe_rating_summary(text) from public;
grant execute on function public.recipe_rating_summary(text) to anon, authenticated;
