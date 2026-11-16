import React from 'react';
import { Download } from 'lucide-react';

interface TopBarProps {
  onNewProject: () => void;
  onOpenProjects: () => void;
  onOpenTapSync: () => void;
  onOpenShortcuts: () => void;
  onOpenExport: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onNewProject,
  onOpenProjects,
  onOpenTapSync,
  onOpenShortcuts,
  onOpenExport,
}) => {
  return (
    <header className="hidden sm:grid h-11 shrink-0 sm:grid-cols-[1fr_auto_1fr] items-center gap-4 px-3.5 lg:px-5 bg-[#0C1117] border-b border-[#273545]">
      <div className="justify-self-start" aria-hidden="true" />

      <nav
        aria-label="Workspace tools"
        className="hidden sm:flex items-center justify-center gap-1.5 text-[11px] font-medium tracking-wide justify-self-center"
      >
        <button
          type="button"
          onClick={onNewProject}
          className="v-btn px-3 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer"
        >
          New Project
        </button>
        <button
          type="button"
          onClick={onOpenProjects}
          className="v-btn px-3 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer"
        >
          Projects
        </button>
        <button
          type="button"
          onClick={onOpenExport}
          className="v-btn-cobalt inline-flex items-center gap-1.5 px-3.5 py-1 text-[11px] uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Export</span>
        </button>
        <button
          type="button"
          onClick={onOpenTapSync}
          className="v-btn px-3 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer"
        >
          Tap Sync
        </button>
        <button
          type="button"
          onClick={onOpenShortcuts}
          className="v-btn px-3 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer"
        >
          Shortcuts
        </button>
      </nav>

      <div className="justify-self-end" aria-hidden="true" />
    </header>
  );
};
