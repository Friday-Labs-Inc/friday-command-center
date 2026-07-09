// Placeholder — a tasteful "designed, wiring in progress" section page, using
// the same design system as the live pages so the nav feels complete and
// intentional while the OS-layer endpoints are still being built.

import { Tag } from '@carbon/react'
import { ConfigCard } from '../components/ConfigCard'

interface PlaceholderProps {
  eyebrow: string
  title: string
  sub: string
  planned: string[]
}

export function Placeholder({ eyebrow, title, sub, planned }: PlaceholderProps) {
  return (
    <div className="cc-page">
      <header className="cc-pagehead">
        <p className="cc-pagehead__eyebrow">{eyebrow}</p>
        <div className="cc-pagehead__row">
          <div>
            <h1 className="cc-pagehead__title">{title}</h1>
            <p className="cc-pagehead__sub">{sub}</p>
          </div>
          <Tag type="blue" size="md">Designed · wiring in progress</Tag>
        </div>
      </header>

      <section className="cc-section">
        <div className="cc-section__head">
          <h2 className="cc-section__title">What this panel will do</h2>
        </div>
        <div className="cc-grid cc-grid--2">
          {planned.map((p, i) => (
            <ConfigCard key={i} status="off">
              <div className="cc-card__body">
                <p className="cc-card__title" style={{ fontWeight: 400, lineHeight: 1.4 }}>{p}</p>
              </div>
            </ConfigCard>
          ))}
        </div>
      </section>
    </div>
  )
}
