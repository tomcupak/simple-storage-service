export namespace RequestLogTypes {
	/** One finished request, as both apps record it. Fields the request has no notion of are
	 *  left undefined and dropped from the line rather than written as null. */
	export interface Entry {
		method: string
		path: string
		status: number
		/** Wall time from the first middleware to the last byte written, in milliseconds. */
		durationMs: number
		bucket?: string
		key?: string
		/** S3 credential the request was signed with; absent on an anonymous or JWT request. */
		accessKeyId?: string
		userGuid?: string
		sourceIp?: string
		userAgent?: string
		bytesIn?: number
		bytesOut?: number
		/** S3 error code or management error code the request ended with. */
		errorCode?: string
	}
}
