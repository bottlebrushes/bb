import type { ReactNode, Ref } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

interface ConversationTimelineProps {
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

export function ConversationTimeline({
  children,
  className,
  ref,
}: ConversationTimelineProps) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex min-w-0 flex-col gap-1 [&_button:not(:disabled)]:cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  );
}
