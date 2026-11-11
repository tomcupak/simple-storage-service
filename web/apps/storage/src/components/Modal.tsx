import { useEffect } from 'react'

import { useI18n } from '../i18n'

/** Dialog shell: backdrop, Escape to close and a title row. The content decides its own
 *  buttons, because every dialog here has a different primary action. */
export function Modal({ title, onClose, children, footer, wide }: {
	title: string
	onClose: () => void
	children: React.ReactNode
	footer?: React.ReactNode
	wide?: boolean
}) {
	const { t } = useI18n()

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [onClose])

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div
				className={`card modal${wide ? ' modal-wide' : ''}`}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				onClick={(event) => event.stopPropagation()}
			>
				<div className="modal-header">
					<h2>{title}</h2>
					<button onClick={onClose} aria-label={t('common.close')}>✕</button>
				</div>
				<div className="modal-body">{children}</div>
				{footer && <div className="modal-footer">{footer}</div>}
			</div>
		</div>
	)
}
