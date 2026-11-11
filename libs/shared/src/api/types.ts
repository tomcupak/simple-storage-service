export interface ApiClientOptions {
	baseUrl: string
	apiKey: string
}

export type Pagination<Item> = {
	data: Item[]
	pagination: {
		totalRecords: number
		currentPage: number
		totalPages: number
	}
}
