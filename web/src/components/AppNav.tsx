type Tab = 'ask' | 'evals' | 'graph' | 'notes';

const TABS: { id: Tab; href: string; label: string }[] = [
  { id: 'ask', href: '/', label: 'Ask' },
  { id: 'evals', href: '/evals', label: 'Evals' },
  { id: 'graph', href: '/graph', label: 'Graph' },
  { id: 'notes', href: '/notes', label: 'Notes' },
];

export function AppNav({ active }: { active: Tab }) {
  return (
    <nav>
      {TABS.map((tab) => (
        <a key={tab.id} href={tab.href} className={active === tab.id ? 'on' : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
