import * as React from "react";
import { cn } from "@/lib/utils";

function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="badge" className={cn("inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground", className)} {...props} />;
}

export { Badge };
