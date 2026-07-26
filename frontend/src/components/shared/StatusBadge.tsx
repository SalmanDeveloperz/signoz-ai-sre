import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type Tone = 'success' | 'destructive' | 'warning' | 'primary' | 'muted'

const toneClasses: Record<Tone, string> = {
  success: 'border-success/30 bg-success/15 text-success [&_svg]:text-success',
  destructive: 'border-destructive/30 bg-destructive/15 text-destructive [&_svg]:text-destructive',
  warning: 'border-warning/30 bg-warning/15 text-warning [&_svg]:text-warning',
  primary: 'border-primary/30 bg-primary/15 text-primary [&_svg]:text-primary',
  muted: 'border-border bg-muted text-muted-foreground',
}

interface StatusBadgeProps {
  tone: Tone
  children: React.ReactNode
  icon?: React.ReactNode
  className?: string
}

/** The one place that decides what color a status word gets, so "allowed"
 * is always the same green everywhere and "blocked" is always the same red. */
export function StatusBadge({ tone, children, icon, className }: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', toneClasses[tone], className)}>
      {icon}
      {children}
    </Badge>
  )
}
