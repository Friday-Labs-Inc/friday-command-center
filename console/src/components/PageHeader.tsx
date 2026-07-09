// PageHeader — breadcrumb + h1 + optional right-aligned actions slot.
// Used at the top of every page.
// Import: import { PageHeader } from '../components/PageHeader'

import type { ReactNode } from 'react'
import { Breadcrumb, BreadcrumbItem, Grid, Column } from '@carbon/react'

export interface PageHeaderProps {
  /** Page title — rendered as <h1> */
  title: string
  /** Optional short description line below the title */
  description?: string
  /** Optional breadcrumb trail; omit for top-level pages */
  breadcrumbs?: Array<{ label: string; href?: string }>
  /** Optional node rendered right-aligned (e.g. a Button or set of buttons) */
  actions?: ReactNode
}

export function PageHeader({ title, description, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="cc-page-header">
      <Grid>
        <Column sm={4} md={8} lg={16}>
          {breadcrumbs && breadcrumbs.length > 0 && (
            <Breadcrumb noTrailingSlash className="cc-page-breadcrumb">
              {breadcrumbs.map(b =>
                b.href ? (
                  <BreadcrumbItem key={b.label} href={b.href}>
                    {b.label}
                  </BreadcrumbItem>
                ) : (
                  <BreadcrumbItem key={b.label} isCurrentPage>
                    {b.label}
                  </BreadcrumbItem>
                ),
              )}
            </Breadcrumb>
          )}
        </Column>

        <Column sm={4} md={actions ? 6 : 8} lg={actions ? 12 : 16}>
          <h1 className="cc-page-title">{title}</h1>
          {description && (
            <p className="cc-page-description">{description}</p>
          )}
        </Column>

        {actions && (
          <Column
            sm={4}
            md={2}
            lg={4}
            className="cc-page-actions"
          >
            {actions}
          </Column>
        )}
      </Grid>
    </div>
  )
}
