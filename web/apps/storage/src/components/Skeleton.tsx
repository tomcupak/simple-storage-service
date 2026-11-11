/** Placeholder rows shown while a table loads, so the layout does not jump once data lands. */
export function TableSkeleton({ columns, rows = 4 }: { columns: number, rows?: number }) {
	return (
		<>
			{Array.from({ length: rows }, (_, rowIndex) => (
				<tr key={rowIndex}>
					{Array.from({ length: columns }, (_, columnIndex) => (
						<td key={columnIndex}><span className="skeleton" /></td>
					))}
				</tr>
			))}
		</>
	)
}

export function BlockSkeleton({ height = 16, width = '100%' }: { height?: number, width?: number | string }) {
	return <span className="skeleton" style={{ height, width }} />
}
