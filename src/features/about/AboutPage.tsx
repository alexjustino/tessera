import {
  Book20Regular,
  BranchFork20Regular,
  Copy20Regular,
  Document20Regular,
  Eye20Regular,
  Open20Regular,
  Shield20Regular,
  Wrench20Regular,
} from '@fluentui/react-icons';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useState } from 'react';

import mark from '@/assets/mark.svg';

import { describeError } from '@/data/errors';
import { fetchSystemInfo, type SystemInfo } from '@/data/system';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Page } from '@/ui/Page';
import { SettingBody, SettingGroup, SettingRow } from '@/ui/Setting';

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
 * the least a piece of software owes the person running it. The long things open
 * on request: the first look is the facts a person came here for.
 */
export function AboutPage({ onOpenDiagnostics }: { onOpenDiagnostics: () => void }) {
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
    <Page>
      <div className="flex w-full max-w-4xl flex-col gap-6 self-center">
        <header className="flex items-center gap-5 rounded-xl border border-stroke-subtle bg-card p-5 shadow-card">
          <img src={mark} alt="" width={72} height={72} draggable={false} className="rounded-xl" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-title font-semibold text-fg">Tessera</h1>
            <p className="mt-0.5 text-body text-fg-secondary">
              A workspace for tasks, projects and time. It runs on this machine and nowhere else.
            </p>
            <p className="mt-1 text-caption text-fg-tertiary">
              Version <span data-selectable>{info?.version ?? '…'}</span>
              {' · '}Apache License 2.0{' · '}© 2026 Alex Justino
            </p>
          </div>
        </header>

        {failure !== null && (
          <InfoBar severity="danger" title="The host did not answer">
            {failure}
          </InfoBar>
        )}

        <SettingGroup title="This build">
          <SettingBody>
            <dl className="grid gap-x-8 gap-y-1.5 text-body sm:grid-cols-2">
              <Fact label="Version" value={info?.version ?? '…'} />
              <Fact label="Workspace schema" value={info ? String(info.schemaVersion) : '…'} />
              <Fact label="Commit" value={__GIT_COMMIT__} mono />
              <Fact label="Platform" value={info?.platform ?? '…'} />
              <Fact label="Built" value={__BUILD_DATE__} />
            </dl>
          </SettingBody>
          <SettingRow
            icon={<Wrench20Regular />}
            title="Diagnostics"
            description="What Tessera can see of this machine and its own workspace."
          >
            <Button onClick={onOpenDiagnostics}>Open diagnostics</Button>
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="Your data">
          <SettingRow
            icon={<Shield20Regular />}
            title="Nothing leaves this machine"
            description="No network requests, no account, no sync, no analytics, no crash reporting, no update check."
          />
          <SettingRow
            icon={<Document20Regular />}
            title="The workspace is one file, and it is yours"
            description={
              info === null ? (
                'Copy it, back it up, or export it to JSON and Markdown.'
              ) : (
                <span data-selectable className="font-mono break-all">
                  {info.databasePath}
                </span>
              )
            }
          />
        </SettingGroup>

        <SettingGroup title="Source and licence">
          <SettingRow
            icon={<BranchFork20Regular />}
            title="Source code"
            description={
              <span data-selectable className="font-mono">
                {REPOSITORY}
              </span>
            }
          >
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
          </SettingRow>
          <Disclosure icon={<Eye20Regular />} title="Licence and trademark">
            <p>
              Made by <strong className="font-semibold text-fg">Alex Justino</strong>. Copyright
              2026 Alex Justino. Licensed under the{' '}
              <strong className="font-semibold text-fg">Apache License 2.0</strong>. You may use,
              modify and redistribute this software under its terms; a redistributed copy keeps this
              notice and says that it was modified.
            </p>
            <p className="mt-2">
              &ldquo;Tessera&rdquo; is a trademark of Alex Justino. The licence covers the source
              code; it does not grant permission to use the project name or wordmark to endorse or
              promote derived products.
            </p>
          </Disclosure>
          <Disclosure
            icon={<Book20Regular />}
            title={`Built on ${credits.length} open source ${credits.length === 1 ? 'project' : 'projects'}`}
          >
            {credits.length === 0 ? (
              <p>The third-party list could not be read from NOTICE.</p>
            ) : (
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
                {credits.map((credit) => (
                  <Fact key={credit.name} label={credit.name} value={credit.licence} inline />
                ))}
              </dl>
            )}
          </Disclosure>
        </SettingGroup>

        <SettingGroup title="The name">
          <Disclosure icon={<Book20Regular />} title="What a tessera is">
            <p>
              In ancient Rome a <em>tessera</em> was a small piece with two lives. One was the{' '}
              <strong className="font-semibold text-fg">mosaic tile</strong>, meaningless on its own
              but locked together with the others it forms the whole image. The other was the{' '}
              <strong className="font-semibold text-fg">
                <em>tessera militaris</em>
              </strong>
              , the small tablet passed down the ranks carrying the watchword and the order of the
              day. A third, the <em>tessera hospitalis</em>, was broken in two between friends, and
              years later the halves fitting together proved the bond.
            </p>
            <p className="mt-2 border-l-2 border-accent pl-3 text-fg">
              A small piece that carries an order, and that only means something once it fits into
              the whole. That is a task inside a project, and a block inside a document.
            </p>
          </Disclosure>
        </SettingGroup>
      </div>
    </Page>
  );
}

/** A row that opens on request. Printed open, so paper loses nothing. */
function Disclosure({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-6 px-4 py-3 text-body text-fg hover:bg-card-hover">
        <span aria-hidden="true" className="flex shrink-0 text-fg-secondary">
          {icon}
        </span>
        <span className="min-w-0 flex-1">{title}</span>
        <span
          aria-hidden="true"
          className="text-fg-tertiary transition-transform group-open:rotate-90"
        >
          ›
        </span>
      </summary>
      <div className="px-4 pb-4 text-body text-fg-secondary">{children}</div>
    </details>
  );
}

function Fact({
  label,
  value,
  mono = false,
  inline = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** Part of a two-column list of its own, rather than a pair of its own. */
  inline?: boolean;
}) {
  const term = <dt className="text-fg-tertiary">{label}</dt>;
  const detail = (
    <dd
      data-selectable
      className={`min-w-0 break-all text-fg ${mono ? 'font-mono text-caption' : ''}`}
    >
      {value}
    </dd>
  );
  if (inline) {
    return (
      <>
        {term}
        {detail}
      </>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-4">
      {term}
      {detail}
    </div>
  );
}
