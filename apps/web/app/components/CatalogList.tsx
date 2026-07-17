// apps/web/app/components/CatalogList.tsx
"use client";

export interface CatalogFilterOption {
  id: string;
  label: string;
}

/**
 * Shared Factorio-mod-menu-style list: a left sidebar of category filters
 * and a scrollable row list. Presentation-only — filtering/searching
 * happens in the caller (DatasetsSection/ModelosSection) before `items`
 * ever reaches this component, and each row's actual content comes from
 * `renderRow`, since datasets and models have genuinely different fields
 * to show (spec: "share layout, not necessarily data shape").
 */
export function CatalogList<T extends { id: string }>({
  items,
  filters,
  activeFilter,
  onFilterChange,
  selectedId,
  onSelect,
  renderRow,
}: {
  items: T[];
  filters: CatalogFilterOption[];
  activeFilter: string;
  onFilterChange: (id: string) => void;
  selectedId: string | null;
  onSelect: (item: T) => void;
  renderRow: (item: T, selected: boolean) => React.ReactNode;
}) {
  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-32 flex-shrink-0 border-r border-white/10 px-2 py-3 text-[11.5px] text-muted">
        {filters.map((f) => (
          <div
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={`mb-0.5 cursor-pointer rounded-md px-2.5 py-1.5 ${
              activeFilter === f.id ? "bg-white/[.06] text-fg" : "hover:text-fg"
            }`}
          >
            {f.label}
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} onClick={() => onSelect(item)} className="cursor-pointer">
            {renderRow(item, item.id === selectedId)}
          </div>
        ))}
        {items.length === 0 && (
          <div className="p-6 text-center text-xs text-subtle">No hay elementos que coincidan.</div>
        )}
      </div>
    </div>
  );
}
