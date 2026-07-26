import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoTooltip } from './InfoTooltip'
import { cn } from '@/lib/utils'

interface SectionCardProps {
  icon: ReactNode
  title: string
  description?: string
  tooltip?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

/**
 * The one card shell every panel in this app is built from, so the whole
 * dashboard reads as one consistent system instead of 6 differently-styled
 * widgets. Icon + title + optional description + optional "(i)" tooltip
 * explaining the panel's purpose + optional header action (e.g. a refresh
 * indicator), then whatever content the feature passes in.
 */
export function SectionCard({
  icon,
  title,
  description,
  tooltip,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={cn('flex flex-col gap-4 py-5', className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 px-5">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-primary [&>svg]:size-4.5" aria-hidden="true">
              {icon}
            </span>
            {title}
            {tooltip && <InfoTooltip>{tooltip}</InfoTooltip>}
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className={cn('px-5', contentClassName)}>{children}</CardContent>
    </Card>
  )
}
