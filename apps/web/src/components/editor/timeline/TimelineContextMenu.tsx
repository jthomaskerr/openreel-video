import React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@openreel/ui";

export const TIMELINE_CONTEXT_MENU_COLLISION_PADDING = 8;

export interface TimelineContextMenuInvocation {
  clientX: number;
  clientY: number;
  sequence: number;
}

interface ClientPoint {
  clientX: number;
  clientY: number;
}

export function captureTimelineContextMenuInvocation(
  event: ClientPoint,
  sequence: number,
): TimelineContextMenuInvocation {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    sequence,
  };
}

const InvocationContext = React.createContext<TimelineContextMenuInvocation | null>(null);

interface TimelineContextMenuProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ContextMenu>, "children"> {
  trigger: React.ReactElement;
  children: React.ReactNode;
}

/**
 * Timeline-specific Radix context-menu root.
 *
 * Radix positions its portal from the trigger's native contextmenu event. Keeping
 * the current client point in state gives each invocation a distinct content key,
 * so a second right-click cannot retain the previous floating anchor.
 */
export function TimelineContextMenu({
  trigger,
  children,
  onOpenChange,
  ...props
}: TimelineContextMenuProps) {
  const sequenceRef = React.useRef(0);
  const [invocation, setInvocation] =
    React.useState<TimelineContextMenuInvocation | null>(null);

  const handleContextMenu = React.useCallback((event: React.MouseEvent) => {
    sequenceRef.current += 1;
    setInvocation(
      captureTimelineContextMenuInvocation(event, sequenceRef.current),
    );
  }, []);

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) setInvocation(null);
      onOpenChange?.(open);
    },
    [onOpenChange],
  );

  return (
    <InvocationContext.Provider value={invocation}>
      <ContextMenu {...props} onOpenChange={handleOpenChange}>
        <ContextMenuTrigger asChild onContextMenu={handleContextMenu}>
          {trigger}
        </ContextMenuTrigger>
        {children}
      </ContextMenu>
    </InvocationContext.Provider>
  );
}

export const TimelineContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuContent>
>(({ collisionPadding = TIMELINE_CONTEXT_MENU_COLLISION_PADDING, ...props }, ref) => {
  const invocation = React.useContext(InvocationContext);

  return (
    <ContextMenuContent
      key={invocation?.sequence ?? 0}
      ref={ref}
      collisionPadding={collisionPadding}
      data-timeline-context-collision-padding={
        typeof collisionPadding === "number" ? collisionPadding : undefined
      }
      data-timeline-context-client-x={invocation?.clientX}
      data-timeline-context-client-y={invocation?.clientY}
      {...props}
    />
  );
});
TimelineContextMenuContent.displayName = "TimelineContextMenuContent";
