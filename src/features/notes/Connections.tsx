import {
  CheckmarkCircle16Regular,
  Document16Regular,
  DocumentAdd16Regular,
  Link20Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useMemo } from 'react';

import { useBacklinks, useBlocks, useCreatePage, usePages } from '@/data/hooks';
import { toDocument } from '@/domain/document';
import { between } from '@/domain/ordering';
import { linksIn, resolve, titleKey, type Page } from '@/domain/page';
import { Button } from '@/ui/Button';
import { Kbd } from '@/ui/Kbd';

/**
 * What a page is connected to, beside it: the links written in it and whether each
 * one finds its page, and what points back at it. The tasks it is applied to are under
 * its name, where they are seen.
 *
 * This is what says a link is really a link. A name that finds nothing is listed
 * as such, with the press that makes it real, rather than looking like the others.
 */
export function Connections({
  page,
  onOpenPage,
  onOpenItem,
}: {
  page: Page;
  onOpenPage: (pageId: string) => void;
  onOpenItem?: ((itemId: string) => void) | undefined;
}) {
  const pages = usePages();
  const blocks = useBlocks('page', page.id);
  const backlinks = useBacklinks(page.id);
  const create = useCreatePage();

  const all = useMemo(() => pages.data ?? [], [pages.data]);

  const links = useMemo(() => {
    const seen = new Set<string>();
    const found: Array<{ key: string; title: string; target: Page | undefined }> = [];
    for (const link of linksIn(toDocument(blocks.data ?? []))) {
      const target = resolve(link, all);
      const key = target?.id ?? `name:${titleKey(link.title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ key, title: target?.title ?? link.title, target });
    }
    return found;
  }, [blocks.data, all]);

  const missing = links.filter((link) => link.target === undefined).length;

  return (
    <div className="flex flex-col gap-5" data-testid="connections">
      <section aria-label="Links on this page">
        <h2 className="mb-2 flex items-center gap-2 text-caption font-semibold text-fg-tertiary uppercase">
          <Link20Regular aria-hidden="true" />
          Links on this page
        </h2>
        {links.length === 0 ? (
          <p className="text-caption text-fg-tertiary">
            Type <Kbd>[[</Kbd> in the text to link a page or a task.
          </p>
        ) : (
          <>
            <p
              className={`mb-1 flex items-center gap-1.5 text-caption ${
                missing > 0 ? 'text-caution' : 'text-success'
              }`}
              data-testid="links-check"
            >
              {missing > 0 ? (
                <Warning16Regular aria-hidden="true" />
              ) : (
                <CheckmarkCircle16Regular aria-hidden="true" />
              )}
              {missing > 0
                ? `${missing} of ${links.length} ${links.length === 1 ? 'link finds' : 'links find'} no page`
                : links.length === 1
                  ? 'The link finds its page'
                  : `All ${links.length} links find their page`}
            </p>
            <ul className="flex flex-col gap-0.5">
              {links.map((link) => (
                <li
                  key={link.key}
                  data-link-check={link.target === undefined ? 'missing' : 'found'}
                >
                  {link.target !== undefined ? (
                    <button
                      type="button"
                      aria-label={`Go to ${link.title}`}
                      onClick={() => onOpenPage(link.target?.id ?? '')}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-body text-accent hover:bg-card-hover"
                    >
                      <Document16Regular aria-hidden="true" className="shrink-0" />
                      <span className="min-w-0 truncate">{link.title}</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 rounded-md px-2 py-1">
                      <DocumentAdd16Regular
                        aria-hidden="true"
                        className="shrink-0 text-fg-tertiary"
                      />
                      <span className="min-w-0 flex-1 truncate text-body text-fg-tertiary">
                        {link.title}
                      </span>
                      <Button
                        appearance="subtle"
                        aria-label={`Create the page ${link.title}`}
                        disabled={create.isPending}
                        onClick={() =>
                          create.mutate(
                            {
                              title: link.title,
                              position: between(all.at(-1)?.position ?? null, null),
                            },
                            { onSuccess: (made) => onOpenPage(made.id) },
                          )
                        }
                      >
                        Create
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-label="Linked from">
        <h2 className="mb-2 flex items-center gap-2 text-caption font-semibold text-fg-tertiary uppercase">
          <Link20Regular aria-hidden="true" />
          Linked from
        </h2>
        {(backlinks.data ?? []).length === 0 ? (
          <p className="text-caption text-fg-tertiary">
            Nothing points here yet. Type <code>[[{page.title}]]</code> in another page.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {(backlinks.data ?? []).map((entry) => (
              <li key={`${entry.ownerKind}:${entry.ownerId}`}>
                {entry.ownerKind === 'page' ? (
                  <button
                    type="button"
                    aria-label={`Open ${entry.title}`}
                    onClick={() => onOpenPage(entry.ownerId)}
                    className="w-full truncate rounded-md px-2 py-1 text-left text-body text-accent hover:bg-card-hover"
                  >
                    {entry.title}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={entry.ownerKind !== 'item'}
                    onClick={() => onOpenItem?.(entry.ownerId)}
                    className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left enabled:hover:bg-card-hover"
                  >
                    <span className="text-caption text-fg-tertiary">
                      {entry.ownerKind === 'item' ? 'Task' : 'Event'}
                    </span>
                    <span className="truncate text-body text-fg">{entry.title}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
