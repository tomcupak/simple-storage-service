export namespace HealthTypes {
	export enum Status {
		ok = 'ok',
		failing = 'failing',
	}

	export interface LivenessResult {
		status: Status
	}

	export interface ReadinessResult {
		status: Status
		database: Status
		storage: Status
	}

	/** Health lives under paths no bucket could ever claim: a leading underscore is outside the
	 *  S3 bucket naming rules, so `/_health` can never shadow a real `/:bucket` route. */
	export const LIVENESS_PATH = '_health'
	export const READINESS_PATH = '_ready'
}
