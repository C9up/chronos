import { describe, expect, it } from "vitest";
import { DateTime, expandRRule, toRRuleString } from "../../src/index.js";

/**
 * [DTSTART, RRULE, limit, occurrences] — the occurrences are what rrule.js
 * 2.8.1 (`rrulestr(...).all()`) returns for the same input.
 */
const RRULE_JS_PARITY: Array<[string, string, number, string[]]> = [
	[
		"2026-01-15T10:00:00Z",
		"FREQ=MONTHLY;COUNT=3",
		10,
		[
			"2026-01-15T10:00:00.000Z",
			"2026-02-15T10:00:00.000Z",
			"2026-03-15T10:00:00.000Z",
		],
	],
	[
		"2026-01-15T10:00:00Z",
		"FREQ=WEEKLY;COUNT=3",
		10,
		[
			"2026-01-15T10:00:00.000Z",
			"2026-01-22T10:00:00.000Z",
			"2026-01-29T10:00:00.000Z",
		],
	],
	[
		"2026-01-15T10:00:00Z",
		"FREQ=YEARLY;COUNT=3",
		10,
		[
			"2026-01-15T10:00:00.000Z",
			"2027-01-15T10:00:00.000Z",
			"2028-01-15T10:00:00.000Z",
		],
	],
	[
		"2026-01-31T10:00:00Z",
		"FREQ=MONTHLY;COUNT=4",
		10,
		[
			"2026-01-31T10:00:00.000Z",
			"2026-03-31T10:00:00.000Z",
			"2026-05-31T10:00:00.000Z",
			"2026-07-31T10:00:00.000Z",
		],
	],
	[
		"2024-02-29T10:00:00Z",
		"FREQ=YEARLY;COUNT=3",
		10,
		[
			"2024-02-29T10:00:00.000Z",
			"2028-02-29T10:00:00.000Z",
			"2032-02-29T10:00:00.000Z",
		],
	],
	[
		"2026-01-01T00:00:00Z",
		"FREQ=HOURLY;BYHOUR=9;COUNT=3",
		10,
		[
			"2026-01-01T09:00:00.000Z",
			"2026-01-02T09:00:00.000Z",
			"2026-01-03T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T00:00:00Z",
		"FREQ=SECONDLY;BYSECOND=0;BYMINUTE=0;COUNT=3",
		10,
		[
			"2026-01-01T00:00:00.000Z",
			"2026-01-01T01:00:00.000Z",
			"2026-01-01T02:00:00.000Z",
		],
	],
	[
		"2026-01-05T00:00:00Z",
		"FREQ=YEARLY;BYDAY=20MO;COUNT=2",
		10,
		["2026-05-18T00:00:00.000Z", "2027-05-17T00:00:00.000Z"],
	],
	[
		"2026-01-01T00:00:00Z",
		"FREQ=MINUTELY;BYHOUR=9;COUNT=70",
		70,
		[
			"2026-01-01T09:00:00.000Z",
			"2026-01-01T09:01:00.000Z",
			"2026-01-01T09:02:00.000Z",
			"2026-01-01T09:03:00.000Z",
			"2026-01-01T09:04:00.000Z",
			"2026-01-01T09:05:00.000Z",
			"2026-01-01T09:06:00.000Z",
			"2026-01-01T09:07:00.000Z",
			"2026-01-01T09:08:00.000Z",
			"2026-01-01T09:09:00.000Z",
			"2026-01-01T09:10:00.000Z",
			"2026-01-01T09:11:00.000Z",
			"2026-01-01T09:12:00.000Z",
			"2026-01-01T09:13:00.000Z",
			"2026-01-01T09:14:00.000Z",
			"2026-01-01T09:15:00.000Z",
			"2026-01-01T09:16:00.000Z",
			"2026-01-01T09:17:00.000Z",
			"2026-01-01T09:18:00.000Z",
			"2026-01-01T09:19:00.000Z",
			"2026-01-01T09:20:00.000Z",
			"2026-01-01T09:21:00.000Z",
			"2026-01-01T09:22:00.000Z",
			"2026-01-01T09:23:00.000Z",
			"2026-01-01T09:24:00.000Z",
			"2026-01-01T09:25:00.000Z",
			"2026-01-01T09:26:00.000Z",
			"2026-01-01T09:27:00.000Z",
			"2026-01-01T09:28:00.000Z",
			"2026-01-01T09:29:00.000Z",
			"2026-01-01T09:30:00.000Z",
			"2026-01-01T09:31:00.000Z",
			"2026-01-01T09:32:00.000Z",
			"2026-01-01T09:33:00.000Z",
			"2026-01-01T09:34:00.000Z",
			"2026-01-01T09:35:00.000Z",
			"2026-01-01T09:36:00.000Z",
			"2026-01-01T09:37:00.000Z",
			"2026-01-01T09:38:00.000Z",
			"2026-01-01T09:39:00.000Z",
			"2026-01-01T09:40:00.000Z",
			"2026-01-01T09:41:00.000Z",
			"2026-01-01T09:42:00.000Z",
			"2026-01-01T09:43:00.000Z",
			"2026-01-01T09:44:00.000Z",
			"2026-01-01T09:45:00.000Z",
			"2026-01-01T09:46:00.000Z",
			"2026-01-01T09:47:00.000Z",
			"2026-01-01T09:48:00.000Z",
			"2026-01-01T09:49:00.000Z",
			"2026-01-01T09:50:00.000Z",
			"2026-01-01T09:51:00.000Z",
			"2026-01-01T09:52:00.000Z",
			"2026-01-01T09:53:00.000Z",
			"2026-01-01T09:54:00.000Z",
			"2026-01-01T09:55:00.000Z",
			"2026-01-01T09:56:00.000Z",
			"2026-01-01T09:57:00.000Z",
			"2026-01-01T09:58:00.000Z",
			"2026-01-01T09:59:00.000Z",
			"2026-01-02T09:00:00.000Z",
			"2026-01-02T09:01:00.000Z",
			"2026-01-02T09:02:00.000Z",
			"2026-01-02T09:03:00.000Z",
			"2026-01-02T09:04:00.000Z",
			"2026-01-02T09:05:00.000Z",
			"2026-01-02T09:06:00.000Z",
			"2026-01-02T09:07:00.000Z",
			"2026-01-02T09:08:00.000Z",
			"2026-01-02T09:09:00.000Z",
		],
	],
	[
		"2026-01-15T10:00:00Z",
		"FREQ=DAILY;UNTIL=20260118T000000Z",
		10,
		[
			"2026-01-15T10:00:00.000Z",
			"2026-01-16T10:00:00.000Z",
			"2026-01-17T10:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=6",
		10,
		[
			"2026-01-30T09:00:00.000Z",
			"2026-02-27T09:00:00.000Z",
			"2026-03-31T09:00:00.000Z",
			"2026-04-30T09:00:00.000Z",
			"2026-05-29T09:00:00.000Z",
			"2026-06-30T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=YEARLY;BYMONTH=1,7;BYDAY=1MO,-1FR;COUNT=8",
		10,
		[
			"2026-01-05T09:00:00.000Z",
			"2026-01-30T09:00:00.000Z",
			"2026-07-06T09:00:00.000Z",
			"2026-07-31T09:00:00.000Z",
			"2027-01-04T09:00:00.000Z",
			"2027-01-29T09:00:00.000Z",
			"2027-07-05T09:00:00.000Z",
			"2027-07-30T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO,FR;COUNT=4",
		10,
		[
			"2026-05-11T09:00:00.000Z",
			"2026-05-15T09:00:00.000Z",
			"2027-05-17T09:00:00.000Z",
			"2027-05-21T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=YEARLY;BYWEEKNO=-1;COUNT=8",
		10,
		[
			"2026-12-28T09:00:00.000Z",
			"2026-12-29T09:00:00.000Z",
			"2026-12-30T09:00:00.000Z",
			"2026-12-31T09:00:00.000Z",
			"2027-01-01T09:00:00.000Z",
			"2027-01-02T09:00:00.000Z",
			"2027-01-03T09:00:00.000Z",
			"2027-12-27T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=YEARLY;BYWEEKNO=1;WKST=SU;BYDAY=SU;COUNT=4",
		10,
		[
			"2026-01-04T09:00:00.000Z",
			"2027-01-03T09:00:00.000Z",
			"2028-01-02T09:00:00.000Z",
			"2028-12-31T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=YEARLY;BYYEARDAY=1,100,-1;COUNT=6",
		10,
		[
			"2026-01-01T09:00:00.000Z",
			"2026-04-10T09:00:00.000Z",
			"2026-12-31T09:00:00.000Z",
			"2027-01-01T09:00:00.000Z",
			"2027-04-10T09:00:00.000Z",
			"2027-12-31T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=MONTHLY;BYMONTHDAY=-1,15;COUNT=6",
		10,
		[
			"2026-01-15T09:00:00.000Z",
			"2026-01-31T09:00:00.000Z",
			"2026-02-15T09:00:00.000Z",
			"2026-02-28T09:00:00.000Z",
			"2026-03-15T09:00:00.000Z",
			"2026-03-31T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU;COUNT=5",
		10,
		[
			"2026-01-13T09:00:00.000Z",
			"2026-03-10T09:00:00.000Z",
			"2026-05-12T09:00:00.000Z",
			"2026-07-14T09:00:00.000Z",
			"2026-09-08T09:00:00.000Z",
		],
	],
	[
		"2026-01-07T09:30:00Z",
		"FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=8",
		10,
		[
			"2026-01-07T09:30:00.000Z",
			"2026-01-09T09:30:00.000Z",
			"2026-01-19T09:30:00.000Z",
			"2026-01-21T09:30:00.000Z",
			"2026-01-23T09:30:00.000Z",
			"2026-02-02T09:30:00.000Z",
			"2026-02-04T09:30:00.000Z",
			"2026-02-06T09:30:00.000Z",
		],
	],
	[
		"2026-01-07T09:30:00Z",
		"FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=TU,SU;COUNT=8",
		10,
		[
			"2026-01-18T09:30:00.000Z",
			"2026-01-20T09:30:00.000Z",
			"2026-02-01T09:30:00.000Z",
			"2026-02-03T09:30:00.000Z",
			"2026-02-15T09:30:00.000Z",
			"2026-02-17T09:30:00.000Z",
			"2026-03-01T09:30:00.000Z",
			"2026-03-03T09:30:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0,30;COUNT=8",
		10,
		[
			"2026-01-01T09:00:00.000Z",
			"2026-01-01T09:30:00.000Z",
			"2026-01-01T17:00:00.000Z",
			"2026-01-01T17:30:00.000Z",
			"2026-01-02T09:00:00.000Z",
			"2026-01-02T09:30:00.000Z",
			"2026-01-02T17:00:00.000Z",
			"2026-01-02T17:30:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=DAILY;INTERVAL=3;BYDAY=MO;COUNT=4",
		10,
		[
			"2026-01-19T09:00:00.000Z",
			"2026-02-09T09:00:00.000Z",
			"2026-03-02T09:00:00.000Z",
			"2026-03-23T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:15:00Z",
		"FREQ=HOURLY;INTERVAL=5;BYHOUR=10,15,20;COUNT=8",
		10,
		[
			"2026-01-02T10:15:00.000Z",
			"2026-01-02T15:15:00.000Z",
			"2026-01-02T20:15:00.000Z",
			"2026-01-07T10:15:00.000Z",
			"2026-01-07T15:15:00.000Z",
			"2026-01-07T20:15:00.000Z",
			"2026-01-12T10:15:00.000Z",
			"2026-01-12T15:15:00.000Z",
		],
	],
	[
		"2026-01-01T09:15:00Z",
		"FREQ=MINUTELY;INTERVAL=15;BYMINUTE=0,30;BYHOUR=9,10;COUNT=8",
		10,
		[
			"2026-01-01T09:30:00.000Z",
			"2026-01-01T10:00:00.000Z",
			"2026-01-01T10:30:00.000Z",
			"2026-01-02T09:00:00.000Z",
			"2026-01-02T09:30:00.000Z",
			"2026-01-02T10:00:00.000Z",
			"2026-01-02T10:30:00.000Z",
			"2026-01-03T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:15:07Z",
		"FREQ=SECONDLY;INTERVAL=7;BYSECOND=0,1,2;COUNT=8",
		10,
		[
			"2026-01-01T09:18:02.000Z",
			"2026-01-01T09:20:01.000Z",
			"2026-01-01T09:22:00.000Z",
			"2026-01-01T09:25:02.000Z",
			"2026-01-01T09:27:01.000Z",
			"2026-01-01T09:29:00.000Z",
			"2026-01-01T09:32:02.000Z",
			"2026-01-01T09:34:01.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=HOURLY;BYMINUTE=0,30;BYSECOND=0;BYSETPOS=-1;COUNT=3",
		10,
		[
			"2026-01-01T09:30:00.000Z",
			"2026-01-01T10:30:00.000Z",
			"2026-01-01T11:30:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=3",
		10,
		[
			"2028-02-29T09:00:00.000Z",
			"2032-02-29T09:00:00.000Z",
			"2036-02-29T09:00:00.000Z",
		],
	],
	[
		"2026-03-01T09:00:00Z",
		"FREQ=MONTHLY;BYDAY=-1SU;BYHOUR=1,2;COUNT=6",
		10,
		[
			"2026-03-29T01:00:00.000Z",
			"2026-03-29T02:00:00.000Z",
			"2026-04-26T01:00:00.000Z",
			"2026-04-26T02:00:00.000Z",
			"2026-05-31T01:00:00.000Z",
			"2026-05-31T02:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=YEARLY;BYDAY=-1SU;COUNT=3",
		10,
		[
			"2026-12-27T09:00:00.000Z",
			"2027-12-26T09:00:00.000Z",
			"2028-12-31T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=YEARLY;BYDAY=53MO;COUNT=3",
		10,
		[
			"2029-12-31T09:00:00.000Z",
			"2035-12-31T09:00:00.000Z",
			"2040-12-31T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13;COUNT=4",
		10,
		[
			"2026-02-13T09:00:00.000Z",
			"2026-03-13T09:00:00.000Z",
			"2026-11-13T09:00:00.000Z",
			"2027-08-13T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=YEARLY;INTERVAL=4;BYMONTH=11;BYDAY=TU;BYMONTHDAY=2,3,4,5,6,7,8;COUNT=3",
		10,
		[
			"2026-11-03T09:00:00.000Z",
			"2030-11-05T09:00:00.000Z",
			"2034-11-07T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=MONTHLY;BYDAY=TU,WE,TH;BYSETPOS=3;COUNT=3",
		10,
		[
			"2026-01-07T09:00:00.000Z",
			"2026-02-05T09:00:00.000Z",
			"2026-03-05T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-2;COUNT=3",
		10,
		[
			"2026-01-29T09:00:00.000Z",
			"2026-02-26T09:00:00.000Z",
			"2026-03-30T09:00:00.000Z",
		],
	],
	[
		"2026-12-30T09:00:00Z",
		"FREQ=WEEKLY;BYDAY=MO,TH,SA;COUNT=6",
		10,
		[
			"2026-12-31T09:00:00.000Z",
			"2027-01-02T09:00:00.000Z",
			"2027-01-04T09:00:00.000Z",
			"2027-01-07T09:00:00.000Z",
			"2027-01-09T09:00:00.000Z",
			"2027-01-11T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T09:00:00Z",
		"FREQ=YEARLY;BYWEEKNO=53;COUNT=3",
		10,
		[
			"2026-12-28T09:00:00.000Z",
			"2026-12-29T09:00:00.000Z",
			"2026-12-30T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T00:00:00Z",
		"FREQ=DAILY;BYMONTH=1;BYDAY=MO;COUNT=6",
		10,
		[
			"2026-01-05T00:00:00.000Z",
			"2026-01-12T00:00:00.000Z",
			"2026-01-19T00:00:00.000Z",
			"2026-01-26T00:00:00.000Z",
			"2027-01-04T00:00:00.000Z",
			"2027-01-11T00:00:00.000Z",
		],
	],
	[
		"2026-01-01T00:00:00Z",
		"FREQ=YEARLY;BYMONTH=3;BYDAY=TH;COUNT=6",
		10,
		[
			"2026-03-05T00:00:00.000Z",
			"2026-03-12T00:00:00.000Z",
			"2026-03-19T00:00:00.000Z",
			"2026-03-26T00:00:00.000Z",
			"2027-03-04T00:00:00.000Z",
			"2027-03-11T00:00:00.000Z",
		],
	],
	[
		"2026-01-01T00:00:00Z",
		"FREQ=YEARLY;BYYEARDAY=-366;COUNT=3",
		10,
		[
			"2028-01-01T00:00:00.000Z",
			"2032-01-01T00:00:00.000Z",
			"2036-01-01T00:00:00.000Z",
		],
	],
	[
		"2026-01-01T00:00:00Z",
		"FREQ=MONTHLY;BYMONTHDAY=31;COUNT=5",
		10,
		[
			"2026-01-31T00:00:00.000Z",
			"2026-03-31T00:00:00.000Z",
			"2026-05-31T00:00:00.000Z",
			"2026-07-31T00:00:00.000Z",
			"2026-08-31T00:00:00.000Z",
		],
	],
	[
		"2026-01-01T00:00:00Z",
		"FREQ=DAILY;BYSETPOS=2;BYHOUR=1,2,3;COUNT=3",
		10,
		[
			"2026-01-01T02:00:00.000Z",
			"2026-01-02T02:00:00.000Z",
			"2026-01-03T02:00:00.000Z",
		],
	],
	[
		"2026-01-01T00:00:00Z",
		"FREQ=WEEKLY;BYDAY=MO,TU;BYSETPOS=-1;BYHOUR=8,9;COUNT=4",
		10,
		[
			"2026-01-06T09:00:00.000Z",
			"2026-01-13T09:00:00.000Z",
			"2026-01-20T09:00:00.000Z",
			"2026-01-27T09:00:00.000Z",
		],
	],
	[
		"2026-01-01T12:00:00Z",
		"FREQ=DAILY;UNTIL=20260103T120000Z",
		10,
		[
			"2026-01-01T12:00:00.000Z",
			"2026-01-02T12:00:00.000Z",
			"2026-01-03T12:00:00.000Z",
		],
	],
	[
		"2026-01-01T12:00:00Z",
		"FREQ=DAILY;INTERVAL=2;COUNT=3;BYMONTH=1,3",
		10,
		[
			"2026-01-01T12:00:00.000Z",
			"2026-01-03T12:00:00.000Z",
			"2026-01-05T12:00:00.000Z",
		],
	],
	[
		"2026-01-02T00:00:00Z",
		"FREQ=MONTHLY;BYMONTHDAY=1,2;BYSETPOS=1,-1;COUNT=4",
		10,
		[
			"2026-01-02T00:00:00.000Z",
			"2026-02-01T00:00:00.000Z",
			"2026-02-02T00:00:00.000Z",
			"2026-03-01T00:00:00.000Z",
		],
	],
];

function timed<T>(fn: () => T): { value: T; ms: number } {
	const t = performance.now();
	const value = fn();
	return { value, ms: performance.now() - t };
}

describe("expandRRule — parity with rrule.js", () => {
	it.each(RRULE_JS_PARITY)("%s %s", (start, rule, limit, expected) => {
		expect(expandRRule(start, rule, limit)).toEqual(expected);
	});

	it("derives the missing day from DTSTART for MONTHLY, WEEKLY and YEARLY", () => {
		const start = "2026-01-15T10:00:00Z";
		expect(expandRRule(start, "FREQ=MONTHLY;COUNT=3")).toEqual([
			"2026-01-15T10:00:00.000Z",
			"2026-02-15T10:00:00.000Z",
			"2026-03-15T10:00:00.000Z",
		]);
		expect(expandRRule(start, "FREQ=WEEKLY;COUNT=3")).toEqual([
			"2026-01-15T10:00:00.000Z",
			"2026-01-22T10:00:00.000Z",
			"2026-01-29T10:00:00.000Z",
		]);
		expect(expandRRule(start, "FREQ=YEARLY;COUNT=3")).toEqual([
			"2026-01-15T10:00:00.000Z",
			"2027-01-15T10:00:00.000Z",
			"2028-01-15T10:00:00.000Z",
		]);
	});

	it("applies BYHOUR as a limit to HOURLY and BYHOUR/BYMINUTE/BYSECOND to SECONDLY", () => {
		expect(
			expandRRule("2026-01-01T00:00:00Z", "FREQ=HOURLY;BYHOUR=9;COUNT=3"),
		).toEqual([
			"2026-01-01T09:00:00.000Z",
			"2026-01-02T09:00:00.000Z",
			"2026-01-03T09:00:00.000Z",
		]);
		expect(
			expandRRule(
				"2026-01-01T00:00:00Z",
				"FREQ=SECONDLY;BYSECOND=0;BYMINUTE=0;COUNT=3",
			),
		).toEqual([
			"2026-01-01T00:00:00.000Z",
			"2026-01-01T01:00:00.000Z",
			"2026-01-01T02:00:00.000Z",
		]);
	});

	it("keeps MINUTELY+BYHOUR strictly increasing and free of duplicates", () => {
		const out = expandRRule(
			"2026-01-01T00:00:00Z",
			"FREQ=MINUTELY;BYHOUR=9;COUNT=70",
			70,
		);
		expect(out).toHaveLength(70);
		expect(new Set(out).size).toBe(70);
		for (let i = 1; i < out.length; i++) {
			expect(Date.parse(out[i] ?? "")).toBeGreaterThan(
				Date.parse(out[i - 1] ?? ""),
			);
		}
		expect(out.slice(58, 62)).toEqual([
			"2026-01-01T09:58:00.000Z",
			"2026-01-01T09:59:00.000Z",
			"2026-01-02T09:00:00.000Z",
			"2026-01-02T09:01:00.000Z",
		]);
	});

	it("counts a YEARLY ordinal BYDAY within the year", () => {
		expect(
			expandRRule("2026-01-05T00:00:00Z", "FREQ=YEARLY;BYDAY=20MO;COUNT=2"),
		).toEqual(["2026-05-18T00:00:00.000Z", "2027-05-17T00:00:00.000Z"]);
	});

	it("keeps a sub-daily INTERVAL on its lattice when a BY* limit skips hours", () => {
		// rrule.js drifts here (its minute carry jumps whole hours); every
		// occurrence below is a multiple of 17 minutes after DTSTART.
		const start = "2026-01-01T09:15:00Z";
		const out = expandRRule(
			start,
			"FREQ=MINUTELY;INTERVAL=17;BYHOUR=10;COUNT=8",
		);
		expect(out).toEqual([
			"2026-01-01T10:06:00.000Z",
			"2026-01-01T10:23:00.000Z",
			"2026-01-01T10:40:00.000Z",
			"2026-01-01T10:57:00.000Z",
			"2026-01-02T10:11:00.000Z",
			"2026-01-02T10:28:00.000Z",
			"2026-01-02T10:45:00.000Z",
			"2026-01-03T10:16:00.000Z",
		]);
		for (const occurrence of out) {
			expect((Date.parse(occurrence) - Date.parse(start)) % (17 * 60_000)).toBe(
				0,
			);
		}
	});
});

describe("expandRRule — UNTIL and parsing", () => {
	it("reads UNTIL in the RFC 5545 forms", () => {
		const start = "2026-01-15T10:00:00Z";
		const three = [
			"2026-01-15T10:00:00.000Z",
			"2026-01-16T10:00:00.000Z",
			"2026-01-17T10:00:00.000Z",
		];
		expect(expandRRule(start, "FREQ=DAILY;UNTIL=20260118T000000Z")).toEqual(
			three,
		);
		expect(expandRRule(start, "FREQ=DAILY;UNTIL=20260117T100000")).toEqual(
			three,
		);
		// A DATE bounds the series inclusively: the 17th's occurrence is in.
		expect(expandRRule(start, "FREQ=DAILY;UNTIL=20260117")).toEqual(three);
		expect(expandRRule(start, "FREQ=DAILY;UNTIL=2026-01-17T10:00:00Z")).toEqual(
			three,
		);
	});

	it("expands the UNTIL that toRRuleString writes", () => {
		const rule = toRRuleString({
			freq: "DAILY",
			until: "2026-01-18T00:00:00Z",
		});
		expect(rule).toBe("FREQ=DAILY;UNTIL=20260118T000000Z");
		expect(expandRRule("2026-01-15T10:00:00Z", rule)).toHaveLength(3);
	});

	it("rejects unknown properties, malformed parts and repeated keys", () => {
		const start = "2026-01-15T10:00:00Z";
		expect(() => expandRRule(start, "FREQ=DAILY;BYDAYX=MO;COUNT=2")).toThrow(
			/Unknown RRULE property 'BYDAYX'/,
		);
		expect(() => expandRRule(start, "FREQ=DAILY;FOO=BAR")).toThrow(
			/Unknown RRULE property 'FOO'/,
		);
		expect(() => expandRRule(start, "FREQ=DAILY;COUNT")).toThrow(
			/expected KEY=VALUE/,
		);
		expect(() => expandRRule(start, "FREQ=DAILY;COUNT=2;COUNT=3")).toThrow(
			/appears twice/,
		);
		expect(() => expandRRule(start, "FREQ=DAILY;UNTIL=tomorrow")).toThrow(
			/Invalid UNTIL/,
		);
		expect(() => expandRRule(start, "FREQ=DAILY;BYHOUR=1.5")).toThrow(
			/Invalid BYHOUR/,
		);
	});
});

describe("expandRRule — bounded work on hostile rules", () => {
	it("treats a BY* list as a set: a 6 KB rule of repeated values costs what one value costs", () => {
		const repeat = (key: string) => `${key}=${Array(1000).fill(0).join(",")}`;
		const hostile = `FREQ=DAILY;${repeat("BYHOUR")};${repeat("BYMINUTE")};${repeat("BYSECOND")};BYSETPOS=1`;
		expect(hostile.length).toBeGreaterThan(6000);
		const plain = "FREQ=DAILY;BYHOUR=0;BYMINUTE=0;BYSECOND=0;BYSETPOS=1";
		const { value, ms } = timed(() =>
			expandRRule("2026-01-01T00:00:00Z", hostile, 1),
		);
		expect(value).toEqual(expandRRule("2026-01-01T00:00:00Z", plain, 1));
		expect(ms).toBeLessThan(100);
	});

	it("does not materialise a full year of seconds to return one occurrence", () => {
		const range = (n: number) =>
			Array.from({ length: n }, (_, i) => i).join(",");
		const rule = `FREQ=YEARLY;BYHOUR=${range(24)};BYMINUTE=${range(60)};BYSECOND=${range(60)};BYYEARDAY=${Array.from({ length: 366 }, (_, i) => i + 1).join(",")}`;
		const { value, ms } = timed(() =>
			expandRRule("2026-12-31T23:59:58Z", rule, 3),
		);
		expect(value).toEqual([
			"2026-12-31T23:59:58.000Z",
			"2026-12-31T23:59:59.000Z",
			"2027-01-01T00:00:00.000Z",
		]);
		expect(ms).toBeLessThan(100);
	});

	it("refuses a rule text over the length cap", () => {
		expect(() =>
			expandRRule(
				"2026-01-01T00:00:00Z",
				`FREQ=DAILY;BYHOUR=${Array(5000).fill(1).join(",")}`,
			),
		).toThrow(/limit is 8192 bytes/);
	});

	it.each([
		["YEARLY", "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30;COUNT=1"],
		["MONTHLY", "FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30"],
		["WEEKLY", "FREQ=WEEKLY;BYMONTH=2;BYMONTHDAY=30"],
		["DAILY", "FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30"],
		["HOURLY", "FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=30;BYHOUR=23"],
		[
			"SECONDLY",
			"FREQ=SECONDLY;BYMONTH=2;BYMONTHDAY=30;BYHOUR=23;BYMINUTE=59;BYSECOND=59",
		],
		["unreachable HOURLY", "FREQ=HOURLY;INTERVAL=2;BYHOUR=1"],
	])(
		"answers [] for an unsatisfiable %s rule without walking for seconds",
		(_label, rule) => {
			const { value, ms } = timed(() =>
				expandRRule("2026-01-05T00:00:00Z", rule, 1),
			);
			expect(value).toEqual([]);
			expect(ms).toBeLessThan(500);
		},
	);

	it("does not slow down with the length of the BYDAY list", () => {
		// The probe from the report: each repeated entry used to cost a scan of
		// 200 000 periods (1.5 s apiece).
		const rule = (n: number) =>
			`FREQ=YEARLY;BYDAY=${Array(n).fill("20MO").join(",")};COUNT=1`;
		const one = timed(() => expandRRule("2026-01-05T00:00:00Z", rule(1), 1));
		const forty = timed(() => expandRRule("2026-01-05T00:00:00Z", rule(40), 1));
		expect(one.value).toEqual(["2026-05-18T00:00:00.000Z"]);
		expect(forty.value).toEqual(one.value);
		expect(forty.ms).toBeLessThan(100);

		const days = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
		const ordinals = [1, 2, 3, 4, 5, -1, -2, -3, -4, -5];
		const every = days.flatMap((d) => ordinals.map((n) => `${n}${d}`));
		const impossible = timed(() =>
			expandRRule(
				"2026-01-05T00:00:00Z",
				`FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30;BYDAY=${[...every, ...every, ...every].join(",")}`,
				1,
			),
		);
		expect(impossible.value).toEqual([]);
		expect(impossible.ms).toBeLessThan(500);
	});
});

describe("toRRuleString — runtime validation", () => {
	it.each([
		[{ freq: "DAILY", byDay: ["MO;COUNT=1"] }, /byDay/],
		[{ freq: "DAILY;COUNT=1" }, /freq/],
		[{ freq: "DAILY", wkst: "MO;X=1" }, /wkst/],
		[{ freq: "DAILY", interval: 1.5 }, /interval/],
		[{ freq: "DAILY", interval: 0 }, /interval/],
		[{ freq: "DAILY", count: -1 }, /count/],
		[{ freq: "DAILY", byHour: [24] }, /byHour/],
		[{ freq: "DAILY", byMinute: [Number.NaN] }, /byMinute/],
		[{ freq: "DAILY", byMonthDay: [0] }, /byMonthDay/],
		[{ freq: "DAILY", bySetPos: ["1;COUNT=9"] }, /bySetPos/],
		[{ freq: "DAILY", until: "not a date" }, /until/],
	])("refuses %j", (input, message) => {
		expect(() => Reflect.apply(toRRuleString, undefined, [input])).toThrow(
			message,
		);
	});

	it("writes a valid structured rule", () => {
		expect(
			toRRuleString({
				freq: "MONTHLY",
				interval: 2,
				wkst: "SU",
				byDay: ["-1FR", "+2MO", "TU"],
				byMonthDay: [1, -1],
				count: 4,
			}),
		).toBe(
			"FREQ=MONTHLY;INTERVAL=2;WKST=SU;BYDAY=-1FR,+2MO,TU;BYMONTHDAY=1,-1;COUNT=4",
		);
	});
});

describe("expandRRule — zones (TZID)", () => {
	const paris = (iso: string) =>
		DateTime.from(iso).setZone("Europe/Paris").toZonedISO();

	it("keeps a Paris 09:00 weekly series at 09:00 across both 2026 transitions", () => {
		const spring = expandRRule("2026-03-23T08:00:00Z", "FREQ=WEEKLY;COUNT=2", {
			tzid: "Europe/Paris",
		});
		expect(spring).toEqual([
			"2026-03-23T08:00:00.000Z",
			"2026-03-30T07:00:00.000Z",
		]);
		const autumn = expandRRule("2026-10-19T07:00:00Z", "FREQ=WEEKLY;COUNT=2", {
			tzid: "Europe/Paris",
		});
		expect(autumn).toEqual([
			"2026-10-19T07:00:00.000Z",
			"2026-10-26T08:00:00.000Z",
		]);
		for (const occurrence of [...spring, ...autumn]) {
			expect(paris(occurrence).slice(11, 16)).toBe("09:00");
		}
	});

	it("inherits the zone of a zoned DateTime start", () => {
		const start = new DateTime("2026-03-23T08:00:00Z", "Europe/Paris");
		expect(expandRRule(start, "FREQ=WEEKLY;COUNT=2")).toEqual([
			"2026-03-23T08:00:00.000Z",
			"2026-03-30T07:00:00.000Z",
		]);
		// A UTC start stays on UTC, as before.
		expect(
			expandRRule(DateTime.from("2026-03-23T08:00:00Z"), "FREQ=WEEKLY;COUNT=2"),
		).toEqual(["2026-03-23T08:00:00.000Z", "2026-03-30T08:00:00.000Z"]);
	});

	it("reads DTSTART;TZID from the iCalendar text", () => {
		expect(
			expandRRule(
				"DTSTART;TZID=Europe/Paris:20260323T090000\nRRULE:FREQ=WEEKLY;COUNT=2",
			),
		).toEqual(["2026-03-23T08:00:00.000Z", "2026-03-30T07:00:00.000Z"]);
		expect(
			expandRRule("DTSTART:20260323T080000Z\r\nRRULE:FREQ=DAILY;COUNT=2", 5),
		).toEqual(["2026-03-23T08:00:00.000Z", "2026-03-24T08:00:00.000Z"]);
	});

	it("shifts a time that falls in the spring gap forward by the gap, and takes the first of two in the autumn overlap", () => {
		expect(
			expandRRule("2026-03-28T01:30:00Z", "FREQ=DAILY;COUNT=3", {
				tzid: "Europe/Paris",
			}).map(paris),
		).toEqual([
			"2026-03-28T02:30:00+01:00",
			"2026-03-29T03:30:00+02:00",
			"2026-03-30T02:30:00+02:00",
		]);
		expect(
			expandRRule("2026-10-24T00:30:00Z", "FREQ=DAILY;COUNT=3", {
				tzid: "Europe/Paris",
			}).map(paris),
		).toEqual([
			"2026-10-24T02:30:00+02:00",
			"2026-10-25T02:30:00+02:00",
			"2026-10-26T02:30:00+01:00",
		]);
	});

	it("reads a floating UNTIL on the zone's wall clock", () => {
		expect(
			expandRRule("2026-03-27T08:00:00Z", "FREQ=DAILY;UNTIL=20260330T090000", {
				tzid: "Europe/Paris",
			}).map(paris),
		).toEqual([
			"2026-03-27T09:00:00+01:00",
			"2026-03-28T09:00:00+01:00",
			"2026-03-29T09:00:00+02:00",
			"2026-03-30T09:00:00+02:00",
		]);
	});

	it("refuses an unknown zone, a missing start and a start given twice", () => {
		expect(() =>
			expandRRule("2026-01-01T00:00:00Z", "FREQ=DAILY", {
				tzid: "Mars/Olympus",
			}),
		).toThrow(/Unknown IANA timezone/);
		expect(() => expandRRule("RRULE:FREQ=DAILY;COUNT=1")).toThrow(/no start/);
		expect(() =>
			expandRRule(
				"2026-01-01T00:00:00Z",
				"DTSTART:20260101T000000Z\nRRULE:FREQ=DAILY",
			),
		).toThrow(/given twice/);
		expect(() =>
			expandRRule(
				"DTSTART;TZID=Europe/Paris:20260101T000000Z\nRRULE:FREQ=DAILY",
			),
		).toThrow(/both a TZID and a UTC/);
	});
});
