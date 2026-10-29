// The cloud panel: opens when you zoom into a cloud. Tabs: Projects · Workers · Skills · Tasks.
import { h, fill, icon, toast, timeAgo } from './dom.js';
import { api } from '../api.js';
import { state, cloudById, tasksIn, LIVE } from '../state.js';
import { taskRow } from './tasks.js';
import { openModal, confirmAction } from './modal.js';
import { markdown } from './markdown.js';

const el = () => document.getElementById('panel');
let tab = 'projects';
let openProject = null;

export function renderPanel() {
  const cloud = cloudById(state.focus);
  if (!cloud) return el().classList.add('hidden');
  el().classList.remove('hidden');

  const tasks = tasksIn(cloud.id);
  const projects = state.projects.filter((p) => p.cloudId === cloud.id);
  const skills = skillsFor(cloud);
  const tabs = [
    ['projects', 'Projects', projects.length],
    ['workers', 'Workers', cloud.workers.length],
    ['skills', 'Skills', skills.length],
    ['tasks', 'Tasks', tasks.length],
  ];

  // Keep scroll position and any half-typed input across live re-renders.
  const scroll = el().querySelector('.panel-body')?.scrollTop || 0;
  const active = document.activeElement;
  const typing = el().contains(active) && active.tagName === 'INPUT' ? { placeholder: active.placeholder, value: active.value } : null;
  fill(el(),
    h('div', { class: 'panel-head' },
      h('h2', { class: 'panel-title' }, h('span', { class: 'swatch', style: { color: cloud.color } }), cloud.name),
      h('p', { class: 'panel-sub' }, cloud.blurb),
      h('div', { class: 'tabs', role: 'tablist' },
        tabs.map(([id, label, count]) =>
          h('button', { class: `tab${tab === id ? ' active' : ''}`, role: 'tab', onclick: () => { tab = id; renderPanel(); } }, label, h('span', { class: 'count' }, count)),
        ),
      ),
    ),
    h('div', { class: 'panel-body' }, VIEWS[tab](cloud, { tasks, projects, skills })),
  );
  el().querySelector('.panel-body').scrollTop = scroll;
  if (typing) {
    const input = el().querySelector(`input[placeholder="${typing.placeholder}"]`);
    if (input) {
      input.value = typing.value;
      input.focus();
    }
  }
}

const VIEWS = {
  projects(cloud, { tasks, projects }) {
    const input = h('input', { class: 'input', placeholder: 'New project name', maxlength: 60 });
    const add = async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      try {
        await api('/api/projects', { method: 'POST', body: { cloudId: cloud.id, name: input.value } });
        input.value = '';
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    return [
      h('form', { class: 'inline-form', onsubmit: add }, input, h('button', { class: 'btn small', type: 'submit' }, icon('plus'), 'Add')),
      projects.length ? projects.map((p) => projectCard(p, tasks.filter((t) => t.projectId === p.id))) : h('div', { class: 'empty' }, 'No projects yet.'),
    ];
  },

  workers(cloud, { tasks }) {
    const cards = cloud.workers.map((id) => {
      const w = state.workers[id] || { name: id };
      const mine = tasks.filter((t) => t.worker === id);
      const running = mine.filter((t) => t.status === 'running');
      const queued = mine.filter((t) => ['queued', 'waiting'].includes(t.status));
      const done = mine.filter((t) => t.status === 'done').length;
      return h('div', { class: 'card' },
        h('div', { class: 'card-row' },
          h('span', { class: `dot ${running.length ? 'info pulse' : queued.length ? 'warn' : ''}` }),
          h('div', { class: 'card-title' }, w.name),
          w.web ? h('span', { class: 'chip', title: 'Can search the web' }, icon('globe'), 'web') : null,
          h('span', { class: 'chip' }, w.tier === 'fast' ? 'economical model' : 'standard model'),
        ),
        h('div', { class: 'card-meta' },
          running.length ? `Working on: ${running.map((t) => t.title).join(', ')}` : queued.length ? `${queued.length} queued` : 'Idle',
          ` · ${done} done`,
        ),
      );
    });
    return [h('div', { class: 'section-title' }, 'Specialists in this area'), cards, h('div', { class: 'section-title' }, 'Information flow'), flows(cloud)];
  },

  skills(cloud, { skills }) {
    if (!skills.length) return h('div', { class: 'empty' }, 'No skills yet. Workers create small reusable skills when a kind of task recurs.');
    return [
      h('p', { class: 'muted', style: { margin: '0 4px 12px', fontSize: '12.5px' } }, 'Checked before every task. Only the 1–2 best matches are loaded, to keep token use low.'),
      skills.map((s) =>
        h('button', { class: 'card', onclick: () => openSkill(s) },
          h('div', { class: 'card-row' }, h('div', { class: 'card-title' }, s.name), h('span', { class: `chip ${s.source === 'builtin' ? '' : 'info'}` }, s.source)),
          h('div', { class: 'card-meta' }, s.description),
        ),
      ),
    ];
  },

  tasks(cloud, { tasks }) {
    if (!tasks.length) return h('div', { class: 'empty' }, `No tasks yet. Ask in the chat — e.g. “Research ${cloud.name.toLowerCase()} trends”.`);
    const sorted = [...tasks].sort((a, b) => (LIVE.includes(b.status) - LIVE.includes(a.status)) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return sorted.slice(0, 60).map((t) => taskRow(t));
  },
};

function projectCard(project, tasks) {
  const live = tasks.filter((t) => LIVE.includes(t.status)).length;
  const done = tasks.filter((t) => t.status === 'done');
  const latest = done.at(-1);
  const isOpen = openProject === project.id;
  const remove = async (e) => {
    e.stopPropagation();
    const ok = await confirmAction('Delete project?', `“${project.name}” and its ${tasks.length} task result${tasks.length === 1 ? '' : 's'} will be permanently deleted.`, 'Delete');
    if (!ok) return;
    try {
      await api(`/api/projects/${project.id}`, { method: 'DELETE' });
      toast('Project deleted');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return h('div', { class: `card clickable${isOpen ? ' open' : ''}`, onclick: (e) => { if (e.target.closest('.nested')) return; openProject = isOpen ? null : project.id; renderPanel(); } },
    h('div', { class: 'card-row' },
      h('span', { class: `dot ${live ? 'info pulse' : done.length ? 'ok' : ''}` }),
      h('div', { class: 'card-title' }, project.name),
      h('span', { class: 'faint', style: { fontSize: '12px' } }, `${tasks.length} task${tasks.length === 1 ? '' : 's'}`),
    ),
    latest && !isOpen ? h('div', { class: 'card-text' }, latest.summary) : null,
    isOpen
      ? h('div', { class: 'nested' },
          tasks.length ? [...tasks].reverse().map((t) => taskRow(t)) : h('div', { class: 'empty' }, 'Empty project.'),
          h('div', { class: 'row-actions', style: { marginTop: '6px' } }, h('button', { class: 'btn small danger', onclick: remove }, icon('trash'), 'Delete project')),
        )
      : null,
  );
}

/** Which workers share results with which — from task dependencies touching this cloud. */
function flows(cloud) {
  const rows = [];
  for (const t of state.tasks.values()) {
    for (const depId of t.dependsOn || []) {
      const dep = state.tasks.get(depId);
      if (!dep || (t.cloudId !== cloud.id && dep.cloudId !== cloud.id)) continue;
      const name = (task) => `${state.workers[task.worker]?.name}${task.cloudId !== cloud.id ? ` (${cloudById(task.cloudId)?.name})` : ''}`;
      rows.push(h('div', { class: 'card flow' },
        h('span', { class: `dot ${dep.status === 'done' ? 'ok' : 'warn'}` }),
        h('span', {}, name(dep)), h('span', { class: 'arrow' }, '→'), h('span', {}, name(t)),
        h('span', { class: 'faint', style: { marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '45%' } }, dep.title),
      ));
    }
  }
  return rows.length ? rows.slice(-12).reverse() : h('div', { class: 'empty' }, 'Workers here run independently. When one needs another’s result, the link appears here and in the world.');
}

function skillsFor(cloud) {
  return state.skills.filter((s) => !s.workers.length || s.workers.some((w) => cloud.workers.includes(w)));
}

async function openSkill(summary) {
  const body = h('div', { class: 'prose' }, h('p', { class: 'muted' }, 'Loading…'));
  const m = openModal({ title: summary.name, subtitle: `${summary.description} · ${summary.source}${summary.created ? ` · ${timeAgo(summary.created)}` : ''}`, body });
  try {
    const skill = await api(`/api/skills/${summary.id}`);
    body.innerHTML = markdown(skill.body);
    body.append(
      h('div', { class: 'chips' }, skill.tags.map((t) => h('span', { class: 'chip' }, t)), skill.origin ? h('span', { class: 'chip info' }, `from ${new URL(skill.origin).host}`) : null),
      skill.source !== 'builtin'
        ? h('div', { class: 'row-actions' }, h('button', { class: 'btn small danger', onclick: async () => {
            await api(`/api/skills/${skill.id}`, { method: 'DELETE' }).catch((err) => toast(err.message, 'error'));
            m.close();
          } }, icon('trash'), 'Remove skill'))
        : null,
    );
  } catch (err) {
    body.textContent = err.message;
  }
}
