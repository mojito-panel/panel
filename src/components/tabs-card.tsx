import type { ReactNode } from 'react';
import { cn } from 'cn';
import { Card, CardContent, CardHeader } from '~/components/ui/card';
import { buttonVariants } from '~/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';

/**
 * Tab triggers reuse the Button look — ghost variant when inactive,
 * primary (default variant) when selected (`data-active` is set by
 * base-ui on the active tab). The `!` markers beat the baked data-active
 * and focus-visible styles of ui/tabs.tsx regardless of CSS order:
 * base-ui focuses the clicked tab asynchronously, which makes
 * :focus-visible match even on mouse click — without the override the
 * stock trigger would show a persistent blue outline/ring.
 */
const tabTriggerVariants = cn(
  buttonVariants({ variant: 'ghost', size: 'default' }),
  'data-active:bg-primary! data-active:text-primary-foreground! data-active:hover:bg-primary/80! dark:data-active:bg-primary! dark:data-active:text-primary-foreground! dark:data-active:hover:bg-primary/80! dark:data-active:border-transparent! focus-visible:outline-none!',
);

/** One tab of a TabsCard: trigger label in the header + panel content. */
export type TabsCardTab = {
  value: string;
  label: ReactNode;
  content: ReactNode;
};

/**
 * Pelican-style tabbed card — a SINGLE card whose header carries the tab
 * buttons directly (no separate tabs row above the card) and whose content
 * renders the active tab. Inactive panels UNMOUNT (base-ui Panel without
 * forceMount): React-held state (e.g. TanStack Form) survives tab switches,
 * but a <form> rendered in one tab is NOT in the DOM while another tab is
 * active — never reference it from another tab (form="id" attribute).
 */
export function TabsCard({
  defaultValue,
  value,
  onValueChange,
  tabs,
  className,
  contentClassName,
}: {
  /** Initially active tab (uncontrolled). */
  defaultValue?: string;
  /** Active tab (controlled). */
  value?: string;
  onValueChange?: (value: string) => void;
  tabs: ReadonlyArray<TabsCardTab>;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Tabs
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      className="gap-0"
    >
      <Card className={className}>
        <CardHeader className="border-b">
          <TabsList className="gap-1 bg-transparent">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className={tabTriggerVariants}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </CardHeader>
        <CardContent className={contentClassName}>
          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              {tab.content}
            </TabsContent>
          ))}
        </CardContent>
      </Card>
    </Tabs>
  );
}

/**
 * Section inside a card content — heading, optional description, fields.
 * Stack sections in a `divide-y` container to separate them with dividers.
 */
export function CardSection({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 py-6 first:pt-0 last:pb-0">
      <div>
        <p className="font-heading text-sm font-medium">{title}</p>
        {description && (
          <p className="text-xs/relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
