import { Copy20Regular, Open20Regular } from '@fluentui/react-icons';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useState } from 'react';

import { describeError } from '@/data/errors';
import { fetchSystemInfo, type SystemInfo } from '@/data/system';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

// The credits are read from NOTICE itself rather than retyped here. Two lists
// of the same thing drift, and the one that drifts is always the one a person
// actually reads.
import notice from '../../../NOTICE?raw';

import { thirdParty } from './notice';

const REPOSITORY = 'https://github.com/alexjustino/tessera';

/**
 * About.
 *
 * Not a version number in a corner. This is where the product says what it is,
 * who made it, what it is licensed under, and what it is built on — which is
 * the least a piece of software owes the person running it.
 */
export function AboutPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const system = await fetchSystemInfo();
        if (active) setInfo(system);
      } catch (error) {
        if (active) setFailure(describeError(error));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const credits = thirdParty(notice);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
      <header>
        <h1 className="font-display text-display font-semibold text-fg">Tessera</h1>
        <p className="mt-1 text-body-lg text-fg-secondary">
          A workspace for tasks, projects and time. It runs on this machine and nowhere else.
        </p>
      </header>

      {/* ── The name ─────────────────────────────────────────────────────── */}
      <Card title="The name">
        <div className="flex flex-col gap-3 text-body text-fg-secondary">
          <p>
            In ancient Rome a <em>tessera</em> was a small piece with two lives.
          </p>
          <p>
            One was the <strong className="font-semibold text-fg">mosaic tile</strong> — meaningless
            on its own, but locked together with the others it forms the whole image. The other was
            the{' '}
            <strong className="font-semibold text-fg">
              <em>tessera militaris</em>
            </strong>
            , the small tablet passed down the ranks carrying the watchword and the order of the
            day: each soldier received one, knew what to do, and passed it on. A third, the{' '}
            <em>tessera hospitalis</em>, was broken in two between friends — each kept a half, and
            years later the halves fitting together proved the bond.
          </p>
          <p className="border-l-2 border-accent pl-3 text-fg">
            A small piece that carries an order, and that only means something once it fits into the
            whole. That is a task inside a project, and a block inside a document.
          </p>
        </div>
      </Card>

      {/* ── This build ───────────────────────────────────────────────────── */}
      <Card
        title="This build"
        description="Read from the running binary, never from a constant typed by hand."
      >
        {failure !== null ? (
          <InfoBar severity="danger" title="The host did not answer">
            {failure}
          </InfoBar>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
            <Row label="Version" value={info?.version ?? '…'} />
            <Row label="Commit" value={__GIT_COMMIT__} mono />
            <Row label="Built" value={__BUILD_DATE__} />
            <Row label="Workspace schema" value={info ? String(info.schemaVersion) : '…'} />
            <Row label="Platform" value={info?.platform ?? '…'} />
          </dl>
        )}
      </Card>

      {/* ── Author and licence ───────────────────────────────────────────── */}
      <Card title="Author and licence">
        <div className="flex flex-col gap-3 text-body text-fg-secondary">
          <p>
            Made by <strong className="font-semibold text-fg">Alex Justino</strong>.
          </p>
          <p>
            Copyright 2026 Alex Justino. Licensed under the{' '}
            <strong className="font-semibold text-fg">Apache License 2.0</strong>. You may use,
            modify and redistribute this software under its terms; a redistributed copy keeps this
            notice and says that it was modified.
          </p>
          <p className="text-caption">
            &ldquo;Tessera&rdquo; is a trademark of Alex Justino. The licence covers the source
            code; it does not grant permission to use the project name or wordmark to endorse or
            promote derived products.
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              icon={<Open20Regular />}
              onClick={() => {
                // Handed to the system browser. The application itself still
                // makes no network request of its own (ADR-012).
                void openUrl(REPOSITORY);
              }}
            >
              Open the repository
            </Button>
            <Button
              appearance="subtle"
              icon={<Copy20Regular />}
              onClick={() => {
                void navigator.clipboard.writeText(REPOSITORY);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy the address'}
            </Button>
            <span data-selectable className="font-mono text-caption text-fg-tertiary">
              {REPOSITORY}
            </span>
          </div>
        </div>
      </Card>

      {/* ── Privacy ──────────────────────────────────────────────────────── */}
      <Card title="Your data">
        <div className="flex flex-col gap-2 text-body text-fg-secondary">
          <p>
            Tessera makes no network requests. There is no account, no sync, no analytics, no crash
            reporting and no update check. Nothing you write here leaves this machine.
          </p>
          {info !== null && (
            <p className="font-mono text-caption break-all text-fg-tertiary" data-selectable>
              {info.databasePath}
            </p>
          )}
          <p className="text-caption">
            That file is yours: copy it, back it up, or export everything to JSON and Markdown.
          </p>
        </div>
      </Card>

      {/* ── Credits ──────────────────────────────────────────────────────── */}
      <Card
        title="Built on"
        description="Read from the project's NOTICE file, so this list cannot drift from the one that ships."
      >
        {credits.length === 0 ? (
          <p className="text-body text-fg-tertiary">
            The third-party list could not be read from NOTICE.
          </p>
        ) : (
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-body">
            {credits.map((credit) => (
              <Row key={credit.name} label={credit.name} value={credit.licence} />
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-fg-tertiary">{label}</dt>
      <dd
        data-selectable
        className={`min-w-0 break-all text-fg ${mono ? 'font-mono text-caption' : ''}`}
      >
        {value}
      </dd>
    </>
  );
}
