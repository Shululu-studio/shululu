import React, { useState } from 'react';
import { Copy, FolderOpen, Plus, Save, Trash2, X } from 'lucide-react';
import { ProjectSummary } from '../types/editor';
import { formatDurationShort } from '../utils/timeFormat';

interface ProjectsModalProps {
  isOpen: boolean;
  currentProjectId: string;
  projects: ProjectSummary[];
  onClose: () => void;
  onSaveCurrent: () => void;
  onCreateNew: (name: string) => void;
  onOpenProject: (id: string) => void;
  onDuplicateProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
}

export const ProjectsModal: React.FC<ProjectsModalProps> = ({
  isOpen,
  currentProjectId,
  projects,
  onClose,
  onSaveCurrent,
  onCreateNew,
  onOpenProject,
  onDuplicateProject,
  onDeleteProject,
  onRenameProject,
}) => {
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="projects-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C1117]/80 p-4"
    >
      <div className="w-full max-w-2xl bg-[#121922] border border-[#273545] rounded-[4px] shadow-[0_16px_48px_rgba(0,0,0,0.7)] flex flex-col max-h-[85vh]">
        <div className="px-4 py-3 border-b border-[#273545] bg-[#19232E] flex items-center justify-between">
          <h2 id="projects-modal-title" className="text-xs font-semibold uppercase tracking-wider text-[#EEF3F8]">
            Projects
          </h2>
          <button
            type="button"
            aria-label="Close projects dialog"
            onClick={onClose}
            className="v-btn p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Create New & Save Current */}
        <div className="p-3.5 border-b border-[#273545] bg-[#121922] flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            aria-label="New project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New project title..."
            className="v-inset flex-1 px-2.5 py-1.5 text-xs text-[#EEF3F8] placeholder:text-[#8696A8] focus:outline-none focus:border-[#EF4444]"
          />
          <button
            type="button"
            onClick={() => {
              onCreateNew(newName.trim() || 'Untitled Lyrics Video');
              setNewName('');
              onClose();
            }}
            className="v-btn-teal inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Create New</span>
          </button>
          <button
            type="button"
            onClick={onSaveCurrent}
            className="v-btn inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 text-[#F87171]" aria-hidden="true" />
            <span>Save Current</span>
          </button>
        </div>

        {/* Project List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#273545] bg-[#0C1117]">
          {projects.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#8696A8]">
              No saved projects yet. Click Save Current to store this project locally.
            </div>
          ) : (
            projects.map((p) => {
              const isCurrent = p.id === currentProjectId;
              const isRenaming = renamingId === p.id;
              return (
                <div
                  key={p.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-[#19232E]"
                >
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={renameDraft}
                          autoFocus
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && renameDraft.trim()) {
                              onRenameProject(p.id, renameDraft.trim());
                              setRenamingId(null);
                            }
                          }}
                          className="v-inset px-2 py-1 text-xs text-[#EEF3F8] focus:outline-none focus:border-[#EF4444]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (renameDraft.trim()) {
                              onRenameProject(p.id, renameDraft.trim());
                            }
                            setRenamingId(null);
                          }}
                          className="v-btn-teal px-2.5 py-1 text-[11px] uppercase cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          className={`v-led ${isCurrent ? 'v-led-active' : ''}`}
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(p.id);
                            setRenameDraft(p.name);
                          }}
                          title="Click to rename"
                          className="text-xs font-medium text-[#EEF3F8] hover:text-[#F87171] truncate cursor-pointer"
                        >
                          {p.name}
                        </button>
                        {isCurrent && (
                          <span className="text-[10px] font-semibold uppercase text-[#F87171]">
                            Active
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-[11px] text-[#8696A8] mt-0.5 font-mono-tabular">
                      {p.aspectRatio} · {p.lineCount} lines · {formatDurationShort(p.duration)} ·{' '}
                      {p.audioFileName || 'No audio'} ·{' '}
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenProject(p.id);
                          onClose();
                        }}
                        className="v-btn-teal inline-flex items-center gap-1 px-2.5 py-1 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
                      >
                        <FolderOpen className="w-3 h-3" aria-hidden="true" />
                        <span>Open</span>
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Duplicate ${p.name}`}
                      onClick={() => onDuplicateProject(p.id)}
                      className="v-btn p-1.5 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => onDeleteProject(p.id)}
                      className="v-btn p-1.5 hover:text-[#E05252] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
