import { useCallback, useEffect, useMemo, useState } from 'react'

import {
	api,
	type InspectResponse,
	type MigrationBucketItem,
	MigrationBucketStatus,
	type MigrationJobDetail,
	type MigrationJobItem,
	MigrationStatus,
} from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorText } from '../components/ErrorText'
import { Modal } from '../components/Modal'
import { type TranslationKey, useI18n } from '../i18n'
import { cs } from '../i18n/translations'
import { formatDate, formatSize } from '../lib/format'

type SourceBucket = InspectResponse['buckets'][number]

const POLL_INTERVAL_MS = 2_000

const STATUS_KEYS: Record<MigrationStatus, TranslationKey> = {
	queued: 'migration.status.queued',
	running: 'migration.status.running',
	completed: 'migration.status.completed',
	failed: 'migration.status.failed',
	cancelled: 'migration.status.cancelled',
}

const BUCKET_STATUS_KEYS: Record<MigrationBucketStatus, TranslationKey> = {
	pending: 'migration.bucketStatus.pending',
	running: 'migration.bucketStatus.running',
	completed: 'migration.bucketStatus.completed',
	failed: 'migration.bucketStatus.failed',
	cancelled: 'migration.bucketStatus.cancelled',
}

const isActive = (status: MigrationStatus) => status === MigrationStatus.queued || status === MigrationStatus.running

const percent = (done: number, total: number) => (total <= 0 ? 0 : Math.min(100, Math.round((done / total) * 100)))

export function MigrationPage() {
	const [selected, setSelected] = useState<string | null>(null)
	const [history, setHistory] = useState<MigrationJobItem[]>([])
	const [historyError, setHistoryError] = useState<unknown>(null)
	const [loaded, setLoaded] = useState(false)

	const refreshHistory = useCallback(async () => {
		try {
			const jobs = await api.listMigrations()
			setHistory(jobs)
			setHistoryError(null)
			return jobs
		} catch (err) {
			setHistoryError(err)
			return []
		}
	}, [])

	// A reload during a migration lands on its progress instead of on an empty form.
	useEffect(() => {
		void refreshHistory().then((jobs) => {
			const active = jobs.find((job) => isActive(job.status))
			if (active) setSelected(active.guid)
			setLoaded(true)
		})
	}, [refreshHistory])

	// Stable identity: JobView's polling effect depends on it, so a fresh function per render would restart it.
	const onChanged = useCallback(() => { void refreshHistory() }, [refreshHistory])

	if (!loaded) return null

	return (
		<>
			{selected
				? <JobView guid={selected} onBack={() => { setSelected(null); void refreshHistory() }} onChanged={onChanged} />
				: <Wizard onStarted={(guid) => { setSelected(guid); void refreshHistory() }} hasActive={history.some((job) => isActive(job.status))} />}
			<History jobs={history} error={historyError} selected={selected} onOpen={setSelected} />
		</>
	)
}

function Wizard({ onStarted, hasActive }: { onStarted: (guid: string) => void, hasActive: boolean }) {
	const { t } = useI18n()
	const [host, setHost] = useState('')
	const [port, setPort] = useState('9000')
	const [useSsl, setUseSsl] = useState(false)
	const [accessKeyId, setAccessKeyId] = useState('')
	const [secretAccessKey, setSecretAccessKey] = useState('')
	const [region, setRegion] = useState('')

	const [inspecting, setInspecting] = useState(false)
	const [buckets, setBuckets] = useState<SourceBucket[] | null>(null)
	const [chosen, setChosen] = useState<Set<string>>(new Set())
	const [overwrite, setOverwrite] = useState<Set<string>>(new Set())
	const [confirming, setConfirming] = useState(false)
	const [starting, setStarting] = useState(false)
	const [error, setError] = useState<unknown>(null)

	const source = () => ({
		host: host.trim(),
		port: Number(port),
		useSsl,
		accessKeyId: accessKeyId.trim(),
		secretAccessKey,
		...(region.trim() ? { region: region.trim() } : {}),
	})

	const canInspect = host.trim() !== '' && Number(port) > 0 && accessKeyId.trim() !== '' && secretAccessKey !== ''

	const inspect = async (event: React.FormEvent) => {
		event.preventDefault()
		setError(null)
		setInspecting(true)
		try {
			const response = await api.inspectMigrationSource(source())
			setBuckets(response.buckets)
			setChosen(new Set(response.buckets.filter((bucket) => bucket.nameValid).map((bucket) => bucket.name)))
			setOverwrite(new Set())
		} catch (err) {
			setBuckets(null)
			setError(err)
		} finally {
			setInspecting(false)
		}
	}

	const toggle = (set: Set<string>, update: (next: Set<string>) => void, name: string) => {
		const next = new Set(set)
		if (next.has(name)) next.delete(name)
		else next.add(name)
		update(next)
	}

	const selectedBuckets = useMemo(() => (buckets ?? []).filter((bucket) => chosen.has(bucket.name)), [buckets, chosen])
	const totalObjects = selectedBuckets.reduce((sum, bucket) => sum + bucket.objectCount, 0)
	const totalBytes = selectedBuckets.reduce((sum, bucket) => sum + bucket.totalBytes, 0)

	const start = async () => {
		setError(null)
		setStarting(true)
		try {
			const job = await api.startMigration({
				source: source(),
				buckets: selectedBuckets.map((bucket) => ({
					name: bucket.name,
					...(bucket.existsLocally ? { overwrite: overwrite.has(bucket.name) } : {}),
				})),
			})
			// The secret was only needed to start the job; do not keep it around.
			setSecretAccessKey('')
			setBuckets(null)
			setConfirming(false)
			onStarted(job.guid)
		} catch (err) {
			setConfirming(false)
			setError(err)
		} finally {
			setStarting(false)
		}
	}

	return (
		<>
			<div className="page-header">
				<h1>{t('migration.title')}</h1>
			</div>
			<p className="muted">{t('migration.intro')}</p>

			<form className="card" onSubmit={(event) => void inspect(event)}>
				<div className="row wrap">
					<div className="field">
						<label htmlFor="mig-host">{t('migration.host')}</label>
						<input id="mig-host" value={host} placeholder="minio.example.com" onChange={(event) => setHost(event.target.value)} />
					</div>
					<div className="field">
						<label htmlFor="mig-port">{t('migration.port')}</label>
						<input id="mig-port" type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} />
					</div>
					<div className="field">
						<label htmlFor="mig-region">{t('migration.region')}</label>
						<input id="mig-region" value={region} placeholder="us-east-1" onChange={(event) => setRegion(event.target.value)} />
					</div>
				</div>
				<div className="row wrap">
					<div className="field">
						<label htmlFor="mig-access">{t('migration.accessKey')}</label>
						<input id="mig-access" value={accessKeyId} autoComplete="off" onChange={(event) => setAccessKeyId(event.target.value)} />
					</div>
					<div className="field">
						<label htmlFor="mig-secret">{t('migration.secretKey')}</label>
						<input id="mig-secret" type="password" value={secretAccessKey} autoComplete="new-password" onChange={(event) => setSecretAccessKey(event.target.value)} />
					</div>
				</div>
				<div className="field">
					<label>
						<input type="checkbox" checked={useSsl} onChange={(event) => setUseSsl(event.target.checked)} /> {t('migration.useSsl')}
					</label>
				</div>
				<button className="primary" type="submit" disabled={!canInspect || inspecting}>
					{inspecting ? t('migration.connecting') : t('migration.connect')}
				</button>
			</form>

			<ErrorText error={error} />

			{buckets && (
				<>
					<h2>{t('migration.plan')}</h2>
					<div className="card">
						<table>
							<thead>
								<tr>
									<th />
									<th>{t('migration.bucket')}</th>
									<th>{t('migration.objects')}</th>
									<th>{t('common.size')}</th>
									<th>{t('migration.versioning')}</th>
									<th>{t('migration.policy')}</th>
									<th>{t('migration.target')}</th>
								</tr>
							</thead>
							<tbody>
								{buckets.map((bucket) => (
									<tr key={bucket.name}>
										<td>
											<input
												type="checkbox"
												aria-label={bucket.name}
												checked={chosen.has(bucket.name)}
												disabled={!bucket.nameValid}
												onChange={() => toggle(chosen, setChosen, bucket.name)}
											/>
										</td>
										<td>
											{bucket.name}
											{!bucket.nameValid && <div className="error">{t('migration.nameInvalid')}</div>}
										</td>
										<td>{bucket.objectCount}</td>
										<td>{formatSize(bucket.totalBytes)}</td>
										<td>{bucket.versioning ?? '—'}</td>
										<td>
											{bucket.hasPolicy ? t('migration.policyYes') : t('migration.policyNo')}
											<PolicyWarnings warnings={bucket.policyWarnings} />
										</td>
										<td>
											{bucket.existsLocally ? (
												<>
													{t('migration.targetMerge')}
													<div>
														<label>
															<input
																type="checkbox"
																checked={overwrite.has(bucket.name)}
																disabled={!chosen.has(bucket.name)}
																onChange={() => toggle(overwrite, setOverwrite, bucket.name)}
															/> {t('migration.overwrite')}
														</label>
													</div>
												</>
											) : t('migration.targetNew')}
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{buckets.length === 0 && <EmptyState icon="🪣" title={t('migration.noBuckets')} />}
					</div>

					<p className="muted">{t('migration.notes')}</p>
					<div className="row">
						<span>{t('migration.summary', { buckets: selectedBuckets.length, objects: totalObjects, size: formatSize(totalBytes) })}</span>
						<button
							className="primary"
							disabled={selectedBuckets.length === 0 || hasActive}
							onClick={() => setConfirming(true)}
						>
							{t('migration.start')}
						</button>
					</div>
					{hasActive && <p className="muted">{t('error.migration_already_running')}</p>}
				</>
			)}

			{confirming && (
				<Modal
					title={t('migration.confirmTitle')}
					onClose={() => setConfirming(false)}
					footer={(
						<>
							<button onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
							<button className="primary" disabled={starting} onClick={() => void start()}>{t('migration.confirmStart')}</button>
						</>
					)}
				>
					<p>{t('migration.confirmBody', { buckets: selectedBuckets.length, objects: totalObjects, size: formatSize(totalBytes) })}</p>
					<p className="muted">{t('migration.notes')}</p>
				</Modal>
			)}
		</>
	)
}

function PolicyWarnings({ warnings }: { warnings: string[] }) {
	const { t } = useI18n()
	if (warnings.length === 0) return null

	const text = (code: string) => {
		const prefix = 'policy_unsupported_condition:'
		if (code.startsWith(prefix)) return t('migration.warning.policy_unsupported_condition', { operator: code.slice(prefix.length) })
		const key = `migration.warning.${code}`
		return key in cs ? t(key as TranslationKey) : code
	}

	return (
		<ul className="muted">
			{warnings.map((code) => <li key={code}>{text(code)}</li>)}
		</ul>
	)
}

function ErrorCode({ code, fallback }: { code: string, fallback?: string }) {
	const { t } = useI18n()
	const key = `error.${code}`
	return <>{key in cs ? t(key as TranslationKey) : (fallback ?? code)}</>
}

function Progress({ done, total, failed }: { done: number, total: number, failed?: boolean }) {
	return (
		<div className={failed ? 'progress failed' : 'progress'}>
			<div className="progress-bar" style={{ width: `${percent(done, total)}%` }} />
		</div>
	)
}

function StatusBadge({ status }: { status: MigrationStatus }) {
	const { t } = useI18n()
	const cls = status === MigrationStatus.completed ? 'badge success' : 'badge'
	return <span className={cls}>{t(STATUS_KEYS[status])}</span>
}

function JobView({ guid, onBack, onChanged }: { guid: string, onBack: () => void, onChanged: () => void }) {
	const { t } = useI18n()
	const [job, setJob] = useState<MigrationJobDetail | null>(null)
	const [error, setError] = useState<unknown>(null)
	const [cancelling, setCancelling] = useState(false)

	const status = job?.status

	useEffect(() => {
		let stopped = false
		let timer: ReturnType<typeof setTimeout> | undefined

		const load = async () => {
			try {
				const next = await api.getMigration(guid)
				if (stopped) return
				setJob(next)
				setError(null)
				if (isActive(next.status)) timer = setTimeout(() => void load(), POLL_INTERVAL_MS)
				else onChanged()
			} catch (err) {
				if (stopped) return
				setError(err)
				// A transient failure should not end the polling of a running job.
				timer = setTimeout(() => void load(), POLL_INTERVAL_MS * 2)
			}
		}
		void load()

		return () => {
			stopped = true
			clearTimeout(timer)
		}
	}, [guid, onChanged])

	const cancel = async () => {
		setCancelling(true)
		setError(null)
		try {
			await api.cancelMigration(guid)
			setJob(await api.getMigration(guid))
		} catch (err) {
			setError(err)
		} finally {
			setCancelling(false)
		}
	}

	return (
		<>
			<div className="page-header">
				<h1>{t('migration.progressTitle')}</h1>
				<div className="row">
					{status && isActive(status) && (
						<button className="danger" disabled={cancelling} onClick={() => void cancel()}>{t('common.cancel')}</button>
					)}
					<button onClick={onBack}>{t('migration.newMigration')}</button>
				</div>
			</div>

			<ErrorText error={error} />

			{job && (
				<>
					<div className="card">
						<div className="row space-between">
							<span>{job.sourceEndpoint}<StatusBadge status={job.status} /></span>
							<span className="muted">{formatDate(job.startedAt ?? job.createdAt)}</span>
						</div>
						{job.error && <p className="error"><ErrorCode code={job.error} /></p>}
						<p>{t('migration.bytesProgress', { done: formatSize(job.bytesDone), total: formatSize(job.bytesTotal), percent: percent(job.bytesDone, job.bytesTotal) })}</p>
						<Progress done={job.bytesDone} total={job.bytesTotal} failed={job.status === MigrationStatus.failed} />
						<p>{t('migration.objectsProgress', { done: job.objectsDone, total: job.objectsTotal, skipped: job.objectsSkipped, failed: job.objectsFailed })}</p>
						<Progress done={job.objectsDone + job.objectsFailed} total={job.objectsTotal} failed={job.status === MigrationStatus.failed} />
					</div>

					<div className="card">
						<table>
							<thead>
								<tr>
									<th>{t('migration.bucket')}</th>
									<th>{t('migration.target')}</th>
									<th>{t('users.status')}</th>
									<th>{t('migration.progress')}</th>
									<th>{t('migration.policy')}</th>
								</tr>
							</thead>
							<tbody>
								{job.buckets.map((bucket) => <BucketRow key={bucket.guid} bucket={bucket} />)}
							</tbody>
						</table>
					</div>

					{job.errors.length > 0 && (
						<>
							<h2>{t('migration.errors')}</h2>
							<div className="card">
								<table>
									<thead>
										<tr>
											<th>{t('migration.bucket')}</th>
											<th>{t('migration.key')}</th>
											<th>{t('migration.errorCode')}</th>
										</tr>
									</thead>
									<tbody>
										{job.errors.map((item) => (
											<tr key={item.guid}>
												<td>{item.bucketName}</td>
												<td>{item.key}</td>
												<td>
													<ErrorCode code={item.code} fallback={item.code} />
													{item.message && <div className="muted">{item.message}</div>}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</>
					)}
				</>
			)}
		</>
	)
}

function BucketRow({ bucket }: { bucket: MigrationBucketItem }) {
	const { t } = useI18n()
	const failed = bucket.status === MigrationBucketStatus.failed

	return (
		<tr>
			<td>{bucket.sourceName}</td>
			<td>
				{bucket.mode === 'merge' ? t('migration.targetMerge') : t('migration.targetNew')}
				{bucket.mode === 'merge' && bucket.overwrite && <div className="muted">{t('migration.overwrite')}</div>}
			</td>
			<td>
				<span className={bucket.status === MigrationBucketStatus.completed ? 'badge success' : 'badge'}>{t(BUCKET_STATUS_KEYS[bucket.status])}</span>
				{bucket.error && <div className="error"><ErrorCode code={bucket.error} /></div>}
			</td>
			<td>
				<Progress done={bucket.bytesDone} total={bucket.bytesTotal} failed={failed} />
				<div className="muted">
					{t('migration.bucketCounters', { done: bucket.objectsDone, total: bucket.objectsTotal, skipped: bucket.objectsSkipped, failed: bucket.objectsFailed })}
					{' · '}{formatSize(bucket.bytesDone)} / {formatSize(bucket.bytesTotal)}
				</div>
			</td>
			<td>
				{bucket.policyMigrated ? t('migration.policyMigrated') : t('migration.policyNo')}
				<PolicyWarnings warnings={bucket.policyWarnings} />
			</td>
		</tr>
	)
}

function History({ jobs, error, selected, onOpen }: { jobs: MigrationJobItem[], error: unknown, selected: string | null, onOpen: (guid: string) => void }) {
	const { t } = useI18n()

	return (
		<>
			<h2>{t('migration.history')}</h2>
			<ErrorText error={error} />
			<div className="card">
				<table>
					<thead>
						<tr>
							<th>{t('common.created')}</th>
							<th>{t('migration.source')}</th>
							<th>{t('users.status')}</th>
							<th>{t('migration.objects')}</th>
							<th>{t('common.size')}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{jobs.map((job) => (
							<tr key={job.guid}>
								<td>{formatDate(job.createdAt)}</td>
								<td>{job.sourceEndpoint}</td>
								<td><StatusBadge status={job.status} /></td>
								<td>
									{job.objectsDone} / {job.objectsTotal}
									{job.objectsFailed > 0 && <span className="error"> · {t('migration.failedCount', { count: job.objectsFailed })}</span>}
								</td>
								<td>{formatSize(job.bytesDone)} / {formatSize(job.bytesTotal)}</td>
								<td className="right">
									<button disabled={selected === job.guid} onClick={() => onOpen(job.guid)}>{t('migration.open')}</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{jobs.length === 0 && <EmptyState icon="📦" title={t('migration.historyEmpty')} />}
			</div>
		</>
	)
}
