import {
  Fragment,
  useRef,
  type CSSProperties,
  type LegacyRef,
  type ReactNode,
  type Ref,
} from "react";
import { Virtualizer } from "virtua";

export interface DataTableColumn<Row> {
  id: string;
  label: string;
  render: (row: Row) => ReactNode;
  numeric?: boolean;
  sortKey?: string;
}

export interface DataTableProps<Row> {
  caption: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  getRowKey: (row: Row) => string;
  getRowHref: (row: Row) => string;
  getRowLabel: (row: Row) => string;
  sort?: { key: string; order: "asc" | "desc" };
  sortBaseHref?: string;
  emptyMessage?: string;
  className?: string;
}

const ROW_HEIGHT = 56;
const VIRTUALIZE_AFTER = 50;
const VIEWPORT_HEIGHT = ROW_HEIGHT * 10;
const OVERSCAN_PX = ROW_HEIGHT * 3;

interface VirtualTableRowProps {
  style: CSSProperties;
  index: number;
  children: ReactNode;
  ref?: LegacyRef<unknown>;
}

function VirtualTableRow({ style, children, ref }: VirtualTableRowProps) {
  return (
    <tr
      ref={ref as Ref<HTMLTableRowElement>}
      className="border-border hover:bg-overlay relative border-b last:border-b-0"
      style={{ ...style, height: `${ROW_HEIGHT}px` }}
    >
      {children}
    </tr>
  );
}

function buildSortHref(baseHref: string, sortKey: string, order: "asc" | "desc") {
  const hashIndex = baseHref.indexOf("#");
  const hash = hashIndex >= 0 ? baseHref.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? baseHref.slice(0, hashIndex) : baseHref;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(search);
  params.set("sort", sortKey);
  params.set("order", order);
  return `${pathname}?${params.toString()}${hash}`;
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowKey,
  getRowHref,
  getRowLabel,
  sort,
  sortBaseHref = "",
  emptyMessage = "표시할 데이터가 없습니다.",
  className = "",
}: DataTableProps<Row>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualized = rows.length > VIRTUALIZE_AFTER;

  const renderCells = (row: Row) =>
    columns.map((column, columnIndex) => (
      <td
        key={column.id}
        className={`t-body-s px-3 py-2 ${column.numeric ? "num text-right" : ""}`}
      >
        {columnIndex === 0 ? (
          <a
            href={getRowHref(row)}
            aria-label={getRowLabel(row)}
            className="absolute inset-0 z-10 rounded-none"
          />
        ) : null}
        <span className="pointer-events-none relative">{column.render(row)}</span>
      </td>
    ));

  return (
    <div
      ref={scrollRef}
      className={`border-border overflow-auto rounded-lg border ${className}`}
      style={virtualized ? { maxHeight: `${VIEWPORT_HEIGHT}px` } : undefined}
    >
      <table
        data-virtualized={virtualized ? "true" : "false"}
        className="w-full border-collapse text-left"
      >
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-raised sticky top-16" style={{ zIndex: "var(--z-sticky)" }}>
          <tr className="border-border border-b">
            {columns.map((column) => {
              const active = column.sortKey && sort?.key === column.sortKey;
              const nextOrder = active && sort?.order === "asc" ? "desc" : "asc";
              const ariaSort = active
                ? sort.order === "asc"
                  ? "ascending"
                  : "descending"
                : "none";
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={column.sortKey ? ariaSort : undefined}
                  className={`t-caption h-12 px-3 font-semibold ${
                    column.numeric ? "num text-right" : ""
                  }`}
                >
                  {column.sortKey ? (
                    <a
                      href={buildSortHref(sortBaseHref, column.sortKey, nextOrder)}
                      aria-label={`${column.label} ${nextOrder === "asc" ? "오름차순" : "내림차순"} 정렬`}
                      className="inline-flex min-h-10 items-center gap-1 underline-offset-4 hover:underline"
                    >
                      {column.label}
                      <span aria-hidden="true">
                        {active ? (sort.order === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </a>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {virtualized ? (
          <Virtualizer
            as="tbody"
            item={VirtualTableRow}
            data={rows}
            itemSize={ROW_HEIGHT}
            bufferSize={OVERSCAN_PX}
            ssrCount={10}
            scrollRef={scrollRef}
          >
            {(row) => <Fragment key={getRowKey(row)}>{renderCells(row)}</Fragment>}
          </Virtualizer>
        ) : (
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                className="border-border hover:bg-overlay relative border-b last:border-b-0"
                style={{ height: `${ROW_HEIGHT}px` }}
              >
                {renderCells(row)}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="t-body-s text-fg-2 h-24 px-3 text-center">
                  {emptyMessage}
                </td>
              </tr>
            ) : null}
          </tbody>
        )}
      </table>
    </div>
  );
}
