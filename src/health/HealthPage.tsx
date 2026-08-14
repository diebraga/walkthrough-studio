import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type Status = "idle" | "healthy" | "error";

// Two distinct failure messages, both safe to show a user: which one it is
// carries no server internals (no stack trace, path, or exception text).
type ErrorReason = "unreachable" | "unhealthy";

const TIMEOUT_MS = 8000;

export function HealthPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [reason, setReason] = useState<ErrorReason | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const check = useCallback(async () => {
    setIsChecking(true);
    try {
      const response = await fetch("/api/health", {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = response.ok ? await response.json().catch(() => null) : null;
      if (response.ok && body?.ok === true) {
        setStatus("healthy");
        setReason(null);
      } else {
        setStatus("error");
        setReason("unhealthy");
      }
    } catch {
      // Network failure, timeout, or CORS — the specific cause isn't shown,
      // only that the service couldn't be reached.
      setStatus("error");
      setReason("unreachable");
    } finally {
      setLastChecked(new Date());
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm ring-foreground/10">
        <CardHeader className="items-center gap-3 pt-2 text-center">
          <StatusGlyph status={status} />
          <div className="space-y-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
              {headline(status)}
            </h1>
            <p className="text-sm text-muted-foreground">{subline(status, reason)}</p>
          </div>
          <StatusBadge status={status} />
        </CardHeader>

        <div className="px-4">
          <Separator />
        </div>

        <CardContent className="flex flex-col items-center gap-3 pb-2 text-center">
          <p className="text-xs text-muted-foreground">
            {lastChecked
              ? `Checked ${lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
              : "Checking…"}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={check}
            disabled={isChecking}
            className="gap-1.5"
          >
            <RefreshCw className={isChecking ? "size-3.5 animate-spin" : "size-3.5"} />
            Check again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusGlyph({ status }: { status: Status }) {
  if (status === "idle") {
    return <Skeleton className="size-12 rounded-full" />;
  }
  if (status === "healthy") {
    return <CheckCircle2 className="size-12 text-success" strokeWidth={1.5} />;
  }
  return <XCircle className="size-12 text-destructive" strokeWidth={1.5} />;
}

function headline(status: Status): string {
  if (status === "healthy") return "All systems operational";
  if (status === "error") return "Service unavailable";
  return "Checking status…";
}

function subline(status: Status, reason: ErrorReason | null): string {
  if (status === "healthy") return "Walkthrough Studio API is responding normally.";
  if (status === "error") {
    return reason === "unreachable"
      ? "Couldn't reach the API. It may be down or unreachable from here."
      : "The API responded, but isn't reporting healthy right now.";
  }
  return "Contacting the API…";
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "idle") {
    return (
      <Badge variant="secondary" className="gap-1">
        <span className="size-1.5 rounded-full bg-muted-foreground" />
        Checking
      </Badge>
    );
  }
  if (status === "healthy") {
    return (
      <Badge className="gap-1 border-transparent bg-success/10 text-success hover:bg-success/10">
        <span className="size-1.5 rounded-full bg-success" />
        Operational
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <span className="size-1.5 rounded-full bg-destructive" />
      Unavailable
    </Badge>
  );
}
