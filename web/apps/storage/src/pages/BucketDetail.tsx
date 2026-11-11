import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'

import { api, type BucketDetail, BucketVersioning } from '../api/client'
import { ErrorText } from '../components/ErrorText'
import { BlockSkeleton } from '../components/Skeleton'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n/translations'
import { BucketAccess } from './bucket/BucketAccess'
import { BucketPolicy } from './bucket/BucketPolicy'
import { BucketSettings } from './bucket/BucketSettings'
import { FileBrowser } from './bucket/FileBrowser'

const TABS = ['files', 'settings', 'access', 'policy'] as const
type Tab = (typeof TABS)[number]

export function BucketDetailPage() {
	const { bucketName = '' } = useParams()
	const { t } = useI18n()
	const [searchParams, setSearchParams] = useSearchParams()

	const tab = (TABS.find((candidate) => candidate === searchParams.get('tab')) ?? 'files') as Tab

	const [bucket, setBucket] = useState<BucketDetail | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<unknown>(null)

	const refresh = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			setBucket(await api.getBucket(bucketName))
		} catch (err) {
			setError(err)
		} finally {
			setLoading(false)
		}
	}, [bucketName])

	useEffect(() => { void refresh() }, [refresh])

	const selectTab = (next: Tab) => {
		// The prefix belongs to the file browser, so leaving it behind keeps a stale folder out
		// of the URL when the user comes back from another tab.
		setSearchParams(next === 'files' ? {} : { tab: next })
	}

	return (
		<>
			<div className="page-header">
				<h1>{bucketName}</h1>
				{loading && !bucket && <BlockSkeleton width={160} />}
			</div>

			<nav className="tabs">
				{TABS.map((candidate) => (
					<button
						key={candidate}
						className={`tab${candidate === tab ? ' active' : ''}`}
						onClick={() => selectTab(candidate)}
					>
						{t(`bucket.tab.${candidate}` as TranslationKey)}
					</button>
				))}
			</nav>

			<ErrorText error={error} />

			{tab === 'files' && (
				<FileBrowser bucketName={bucketName} versioned={bucket ? bucket.versioning !== BucketVersioning.disabled : false} />
			)}
			{tab === 'settings' && bucket && <BucketSettings bucket={bucket} onChanged={refresh} />}
			{tab === 'access' && bucket && <BucketAccess bucket={bucket} />}
			{tab === 'policy' && <BucketPolicy bucketName={bucketName} />}
		</>
	)
}
