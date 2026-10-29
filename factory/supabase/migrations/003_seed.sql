-- Seed data: the owner, the seven clouds, starter projects, built-in skills and the daily briefing.

-- Only this email address can sign in and see the factory.
insert into public.settings (owner_email) values ('matthew.preston2019@gmail.com');

insert into public.clouds (id, name, color, blurb, workers, position, sort) values
  ('gaming', 'Gaming', '#8b7bff', 'Games, Minecraft servers, game ideas and development', array['research','coding','content']::text[], array[0.0,0.6,8.5], 0),
  ('engineering', 'Engineering', '#4f9dff', 'Websites, applications, coding projects and technical tools', array['coding','research']::text[], array[-9.38,-0.8,5.3], 1),
  ('content', 'Content', '#ff6b8b', 'YouTube ideas, scripts, editing workflows and analytics', array['content','research']::text[], array[-11.7,1.4,-1.89], 2),
  ('finance', 'Finance & Business', '#34d399', 'Business research, budgets, costs and opportunities', array['finance','research']::text[], array[-5.21,-1.1,-7.66], 3),
  ('research', 'Research', '#22d3ee', 'Information gathering, trends and discovering opportunities', array['research']::text[], array[5.21,0.3,-7.66], 4),
  ('automation', 'Automation', '#fbbf24', 'Scheduled tasks, file organisation and repetitive work', array['automation','coding']::text[], array[11.7,1.7,-1.89], 5),
  ('assistant', 'Personal Assistant', '#e879f9', 'Tasks, reminders and daily briefings', array['assistant']::text[], array[9.38,-0.3,5.3], 6);

insert into public.projects (cloud_id, name) values
  ('gaming', 'Game Ideas'),
  ('gaming', 'Minecraft Servers'),
  ('gaming', 'Game Development'),
  ('engineering', 'Websites'),
  ('engineering', 'Applications'),
  ('engineering', 'Tools'),
  ('content', 'YouTube Ideas'),
  ('content', 'Scripts'),
  ('content', 'Editing & Analytics'),
  ('finance', 'Business Research'),
  ('finance', 'Budgets & Costs'),
  ('finance', 'Opportunities'),
  ('research', 'Trends'),
  ('research', 'Deep Dives'),
  ('automation', 'Scheduled Jobs'),
  ('automation', 'File Organisation'),
  ('assistant', 'Tasks & Reminders'),
  ('assistant', 'Daily Briefings');

insert into public.skills (id, name, description, tags, workers, source, body) values
  ('business-analysis', 'Business analysis', 'Evaluate a business idea or opportunity with costs, revenue and risks.', array['business','analysis','budget','costs','revenue','opportunity','finance','pricing']::text[], array['finance','research']::text[], 'builtin', '- Summarise the opportunity and who pays for it.
- Estimate start-up and monthly costs in a small table; state every assumption.
- Estimate revenue with a conservative, expected and optimistic case.
- Break-even point and the key number that decides success.
- Top risks and cheap ways to validate before spending money.
- Verdict: pursue, test first, or drop — with one sentence why.'),
  ('daily-briefing', 'Daily briefing', 'Write a short morning briefing that only covers what matters today.', array['briefing','daily','summary','reminders','tasks','today']::text[], array['assistant']::text[], 'builtin', '- Greeting in one line.
- "Needs you": approvals and failures first, each one line with the action to take.
- "Done": the most useful finished results, one line each, skip trivia.
- "Today": anything scheduled or due.
- Keep it under 200 words. If there is nothing important, say so in one line.'),
  ('dev-plan', 'Development plan', 'Break a software or game build into milestones with a lean, testable scope.', array['development','plan','roadmap','milestones','build','app','website','code']::text[], array['coding']::text[], 'builtin', '- State the goal and the smallest version that delivers it.
- Recommend a simple stack and say why; avoid unnecessary dependencies.
- Milestones of 1–5 days, each ending with something runnable and testable.
- List the riskiest unknowns and tackle them first.
- Note hosting, data storage and cost implications.
- Keep code examples complete and runnable when included.'),
  ('file-organisation', 'File organisation', 'Design a clean folder structure and naming rules, plus a safe migration plan.', array['files','folders','organise','organize','naming','cleanup','automation']::text[], array['automation']::text[], 'builtin', '- Propose a folder tree (max 3 levels) grouped by area, then project.
- Naming rule: date-first (YYYY-MM-DD) or project-first; one rule only.
- Identify duplicates by name, size and hash before touching anything.
- Never delete: move to an "_archive" folder and request approval for deletion.
- Provide a script only in dry-run mode first, listing every change.'),
  ('game-concept-pitch', 'Game concept pitch', 'Shape a game idea into a clear one-page concept with core loop and scope.', array['game','concept','idea','pitch','design','gameplay','minecraft']::text[], array['content','coding','research']::text[], 'builtin', '- One-line hook, genre and target player.
- Core loop: what the player does every 30 seconds, every 10 minutes, every session.
- 3 pillars that make it distinct; reference 1–2 comparable games.
- Minimum playable version: the smallest scope worth testing.
- Risks (technical, design, market) and how to test each cheaply.
- Next 3 concrete steps.'),
  ('web-research-brief', 'Web research brief', 'Turn a research question into a short, sourced, decision-ready brief.', array['research','trends','sources','brief','market','competitors']::text[], array['research','finance']::text[], 'builtin', '- Restate the question in one line and what decision it supports.
- Search 2–3 times with specific queries; prefer primary and recent sources.
- Separate facts (with source) from your interpretation.
- Give 3–6 key findings, each one sentence, most important first.
- Note what is uncertain or could not be verified.
- End with "What this means" (2–3 bullets) and suggested next steps.'),
  ('youtube-script', 'YouTube script', 'Write a tight YouTube script with a strong hook, structure and retention beats.', array['youtube','script','video','hook','content','shorts']::text[], array['content']::text[], 'builtin', '- Title options (3) and a thumbnail concept in one line.
- Hook in the first 10 seconds: promise the payoff, no intro filler.
- Structure in clear sections with a retention beat (question, reveal, change of pace) every 60–90s.
- Write in spoken language; short sentences.
- Mark B-roll and on-screen text cues in [brackets].
- End with a natural call to action tied to the next video.');

insert into public.schedules (kind, name, cloud_id, project_id, worker, instruction, every, at)
select 'briefing', 'Daily briefing', 'assistant', id, 'assistant', 'Write my daily briefing.', 'daily', '08:00'
from public.projects where cloud_id = 'assistant' and name = 'Daily Briefings';
