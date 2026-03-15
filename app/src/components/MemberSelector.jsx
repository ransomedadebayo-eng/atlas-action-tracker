import React, { useState, useRef, useEffect } from 'react';
import { Search, X, Check } from 'lucide-react';
import { getMemberColor } from '../utils/colors.js';
import { getInitials } from '../utils/memberUtils.js';

export default function MemberSelector({ members = [], selected: selectedProp, selectedIds, onChange, placeholder = 'Select members...' }) {
  const selected = selectedProp || selectedIds || [];
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = members.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.id.toLowerCase().includes(search.toLowerCase())
  );

  function toggle(memberId) {
    if (selected.includes(memberId)) {
      onChange(selected.filter(id => id !== memberId));
    } else {
      onChange([...selected, memberId]);
    }
  }

  function remove(memberId) {
    onChange(selected.filter(id => id !== memberId));
  }

  return (
    <div ref={ref} className="relative">
      <div
        className="input-field cursor-pointer min-h-[38px] flex flex-wrap items-center gap-1"
        onClick={() => setIsOpen(true)}
        aria-expanded={isOpen}
      >
        {selected.length === 0 && (
          <span className="text-text-muted text-sm">{placeholder}</span>
        )}
        {selected.map(id => {
          const member = members.find(m => m.id === id);
          const name = member ? member.name : id;
          const color = getMemberColor(id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {name}
              <X
                className="w-3 h-3 cursor-pointer hover:opacity-70"
                onClick={(e) => { e.stopPropagation(); remove(id); }}
              />
            </span>
          );
        })}
      </div>

      {isOpen && (
        <div role="listbox" className="absolute z-50 top-full left-0 right-0 mt-1 bg-bg-surface border border-border rounded-lg shadow-xl max-h-60 overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                className="w-full bg-bg-primary border border-border rounded-md pl-7 pr-3 py-1.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
                placeholder="Search members..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-y-auto max-h-48">
            {filtered.map(member => {
              const isSelected = selected.includes(member.id);
              const color = getMemberColor(member.id);
              return (
                <button
                  key={member.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-bg-elevated transition-colors ${
                    isSelected ? 'text-text-primary' : 'text-text-secondary'
                  }`}
                  onClick={() => toggle(member.id)}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-semibold flex-shrink-0"
                    style={{ backgroundColor: `${color}30`, color }}
                  >
                    {getInitials(member.name)}
                  </div>
                  <span className="flex-1">{member.name}</span>
                  {member.role && (
                    <span className="text-text-muted text-xs">{member.role}</span>
                  )}
                  {isSelected && <Check className="w-4 h-4 text-accent flex-shrink-0" />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-text-muted text-sm">
                No members found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
