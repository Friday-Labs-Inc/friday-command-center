// DataTablePanel — shared Carbon DataTable wrapper.
//
// LAYER RULE: the panel wraps its TableContainer in <Layer> so the table
// renders on layer-01 (one step above the page background). Nesting another
// <Layer> inside a DataTablePanel (e.g. an expand panel) gives layer-02.
//
// Cell values may be any ReactNode — pre-render <StatusTag> or other
// components in the row data before passing rows here.
// NOTE: JSX values in cells disable Carbon's built-in sort/search on those
// columns. For sortable/searchable columns, use plain string values and
// render tags in the cell renderer pattern below.
//
// Import: import { DataTablePanel } from '../components/DataTablePanel'

import { useState, type ReactNode } from 'react'
import {
  DataTable,
  DataTableSkeleton,
  Layer,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
} from '@carbon/react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DTPHeader {
  key: string
  header: string
}

/** Every row MUST have an id field. Values may be any ReactNode. */
export interface DTPRow {
  id: string
  [key: string]: ReactNode
}

export interface DataTablePanelProps {
  /** Section title shown above the toolbar */
  title: string
  /** Optional sub-heading below the title */
  description?: string
  /** Column definitions passed to Carbon DataTable */
  headers: DTPHeader[]
  /** Row data; each row must include `id: string` */
  rows: DTPRow[]
  /** When true, shows DataTableSkeleton instead of the table */
  loading?: boolean
  /** Renders a persistent search box in the toolbar */
  searchable?: boolean
  /** Called with the row id when the user clicks a row */
  onRowClick?: (rowId: string) => void
  /** Extra nodes appended to the toolbar after the search box */
  toolbarActions?: ReactNode
  /** Initial page size; defaults to 20 */
  pageSize?: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DataTablePanel({
  title,
  description,
  headers,
  rows,
  loading = false,
  searchable = false,
  onRowClick,
  toolbarActions,
  pageSize: initialPageSize = 20,
}: DataTablePanelProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)

  if (loading) {
    return (
      <Layer>
        <DataTableSkeleton
          headers={headers}
          rowCount={5}
          showHeader
          showToolbar={searchable || !!toolbarActions}
        />
      </Layer>
    )
  }

  const start = (page - 1) * pageSize
  const pageRows = rows.slice(start, start + pageSize)

  return (
    <Layer>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <DataTable rows={pageRows as any[]} headers={headers} isSortable>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {({ rows: dtRows, headers: dtHeaders, getTableProps, getHeaderProps, getRowProps, onInputChange }: any) => (
          <TableContainer title={title} description={description}>
            <TableToolbar>
              <TableToolbarContent>
                {searchable && (
                  <TableToolbarSearch
                    onChange={onInputChange}
                    persistent
                    placeholder="Search…"
                  />
                )}
                {toolbarActions}
              </TableToolbarContent>
            </TableToolbar>

            <Table {...getTableProps()} size="sm" useZebraStyles>
              <TableHead>
                <TableRow>
                  {dtHeaders.map((h: { key: string; header: string }) => {
                    const { key: _hk, ...headerProps } = getHeaderProps({ header: h })
                    return (
                      <TableHeader key={h.key} {...headerProps}>
                        {h.header}
                      </TableHeader>
                    )
                  })}
                </TableRow>
              </TableHead>

              <TableBody>
                {dtRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={headers.length}>
                      <span style={{ color: 'var(--cds-text-secondary)' }}>
                        No records found.
                      </span>
                    </TableCell>
                  </TableRow>
                ) : (
                  dtRows.map((row: { id: string; cells: Array<{ id: string; value: ReactNode }> }) => {
                    const { key: _rk, ...rowProps } = getRowProps({ row })
                    return (
                      <TableRow
                        key={row.id}
                        {...rowProps}
                        onClick={onRowClick ? () => onRowClick(row.id) : undefined}
                        style={onRowClick ? { cursor: 'pointer' } : undefined}
                      >
                        {row.cells.map(cell => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>

      {rows.length > pageSize && (
        <Pagination
          totalItems={rows.length}
          pageSize={pageSize}
          pageSizes={[10, 20, 50, 100]}
          page={page}
          onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
            setPage(p)
            setPageSize(ps)
          }}
        />
      )}
    </Layer>
  )
}
