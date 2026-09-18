export function EmptyState({ icon, title, hint, action }: {
	icon?: string
	title: string
	hint?: string
	action?: React.ReactNode
}) {
	return (
		<div className="empty-state">
			{icon && <div className="empty-state-icon" aria-hidden="true">{icon}</div>}
			<p className="empty-state-title">{title}</p>
			{hint && <p className="muted">{hint}</p>}
			{action}
		</div>
	)
}
