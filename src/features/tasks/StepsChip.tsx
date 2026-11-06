import { TaskListLtrRegular } from '@fluentui/react-icons';

import type { Progress } from '@/domain/subtasks';
import { Chip } from '@/ui/Chip';

/** How far along a task's subtasks are, on its row and its card. */
export function StepsChip({ progress }: { progress: Progress | undefined }) {
  if (progress === undefined || progress.total === 0) return null;
  const words = `${progress.done} of ${progress.total} subtasks done`;
  return (
    <span role="img" aria-label={words} title={words} data-task-steps={progress.done}>
      <Chip tone={progress.done === progress.total ? 'success' : 'neutral'}>
        <TaskListLtrRegular aria-hidden="true" />
        {progress.done}/{progress.total}
      </Chip>
    </span>
  );
}
