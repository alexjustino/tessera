/** The shape of what is coming, for the moment a screen is being read. Never a spinner. */
export function Skeleton() {
  return (
    <div className="flex flex-col gap-2 p-6" aria-hidden="true" data-testid="skeleton">
      <div className="h-8 w-48 animate-pulse rounded-md bg-card-hover" />
      <div className="h-24 animate-pulse rounded-xl bg-card-hover" />
      <div className="h-48 animate-pulse rounded-xl bg-card-hover" />
    </div>
  );
}
