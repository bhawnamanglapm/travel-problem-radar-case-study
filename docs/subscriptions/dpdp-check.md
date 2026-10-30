# India's data law (DPDP): what the radar does today, for an adviser

> Written 2026-10-31 for the owner to take to an adviser (T30 step 9, T00 step 8, R-17). **This is not legal
> advice.** It lists the duties of India's Digital Personal Data Protection Act, 2023 and its Rules, as two
> secondary sources describe them, next to what the code does today. The adviser confirms the duties; the official
> text of the Rules was not read (the government PDF could not be opened here).

## Dates

| When | What starts | Source |
|---|---|---|
| 13 Nov 2025 | The DPDP Rules notified. Definitions and the Data Protection Board apply at once | [AZB & Partners][azb]; [The Tribune][tribune] |
| 12 Nov 2026 | Registration of consent managers | [AZB & Partners][azb] |
| 12 May 2027 | The main duties of a business that holds personal data (a "data fiduciary"): notice, consent and legitimate uses, security safeguards, breach notification, retention and erasure, the rights of the people the data is about, children's data, transfers abroad | [AZB & Partners][azb] |

So the duties below are not yet in force (on 2026-10-31), but they will be by 12 May 2027, and government buyers
(RM-40) may ask about them sooner.

## What the radar holds

From [`api/_lib/subscribers.js`](../../api/_lib/subscribers.js) and the [privacy page](../../legal/privacy/index.html):

- **Per member** (one record, `radar:sub:<id>`, the id a SHA-256 hash of the address): the email address; status,
  plan, chosen categories, areas and emails a day; the sign-up, confirmation and Pro request dates; a random link
  token; Pro's saved problems (at most 100); for a password, a scrypt hash only; for a sign-in link, a hash of its
  code, cleared when used; for paid Pro, the Razorpay subscription id, its status and dates (`rzp`).
- **Elsewhere:** Razorpay index files (`radar:rzpsub:`) that point a subscription to a record; record ids in the
  daily Free delivery files (`radar:deliveries:`); event counts with only type, time and plan; a shortened hash of
  the IP address for rate limits, kept 2 hours (`IPHIT_KEEP_HOURS`).
- **Not held:** card or UPI details (Razorpay's checkout), Google account id, name or token. The address is never
  logged (the header of `subscribers.js`). The LLM logs and saved sweeps hold no member data.
- **Who else handles it:** Vercel (hosting and the store), Resend (sending), Google (only for "Continue with
  Google"), Razorpay (payments, live since 2026-10-28, T30 step 4).

## Duty by duty

"Asks" is the duty as the sources above list it; the details are **to verify** with the adviser.

| Duty | Asks | The radar today | Gap or question for the adviser |
|---|---|---|---|
| Notice | Tell people what is collected and why, and how to use their rights and complain | The privacy page lists the data, the use, the processors, how long it is kept and a contact; the sign-up page has a short version | The privacy page doesn't name **Razorpay** as a processor, though payments are live. It doesn't say people can complain to the Data Protection Board. Whether the notice must also be offered in Indian languages: **to verify** |
| Consent | Consent that is free, specific and given by a clear act, and as easy to withdraw as to give | Double opt-in: nothing is sent until the address is confirmed from the email. Every email has Unsubscribe; for Free, that deletes the record | No tick box or "I agree" at sign-up: is confirming the address a clear enough act? |
| Legitimate uses | Some uses need no consent | Payments are for a contract the member starts | Which of the radar's uses count: **to verify** |
| Security safeguards | Reasonable safeguards against a breach | Private Blob store; scrypt password hashes; hashed sign-in codes; a signed session cookie, 12 hours at most; the address never logged; the IP address only as a short hash, deleted in 2 hours | The read-write Blob token sits on the owner's machine (`.env.local`). No written list of who has access. Whether the Rules require keeping access logs for a set time: **to verify** |
| Breach notification | Tell the Board and each person affected | **No written breach plan** | Write one: who decides, what is told to whom, how fast. The deadline in the Rules: **to verify** |
| Retention and erasure | Delete when the purpose is over or consent is withdrawn | Unconfirmed in 7 days: deleted. Free unsubscribe, a hard bounce or a spam mark: deleted at once. **Delete my account** cancels Razorpay first, then deletes the record, its Razorpay index files and its id in the delivery files (`deleteAccount`, `deleteSubscriberData`) | A Pro member who turns emails off keeps the account until they delete it, with no time limit. Razorpay, Resend and Vercel keep their own logs. Tax law may require payment records to be kept: how that fits with erasure |
| Rights of the person | See, correct and erase their data; a grievance route; name someone to act for them | The manage page changes choices and deletes the account; requests to see or delete data go to the privacy page's contact, with a same-day reply promised | No self-serve copy of the data. Naming someone to act for them is not covered. The time allowed to answer a grievance: **to verify** |
| Children | Verifiable consent of a parent | No age question, and the terms don't say members must be adults | Whether a line in the terms ("18 or over") is enough, or more is needed |
| Transfers abroad | Allowed except to countries the government restricts (**to verify**) | The privacy page says data may be processed outside India, including the United States | Whether any processor's country is restricted once a list is published |
| Processors | A business answers for its processors | Each provider's own standard terms | Whether those terms are enough, or a written agreement is needed |
| Significant data fiduciary | Extra duties for businesses the government names | Small: no claim of member numbers is made here | Unlikely to apply; **to verify** what decides it |

## For government work (RM-40)

The radar's items come from public sources about travel problems, not from members, so the monthly India report
(RM-39) would hold no member data. The duties above are about members. Two questions for the adviser before RM-40:

1. Does an item that names a person (for example, a traveller quoted in the news) bring any duty?
2. If a government buyer asked for member or usage data, what consent would be needed first? Nothing of the kind
   is planned.

## What to change after advice

Nothing is changed by this document. Likely changes, each for the owner to decide after advice:

- name Razorpay, and the Data Protection Board, on the privacy page;
- a written breach plan;
- an age line in the terms;
- a time limit for Pro accounts with emails off.

[azb]: https://www.azbpartners.com/bank/indias-digital-personal-data-protection-act-phased-rollout-and-key-compliance-milestones/
[tribune]: https://www.tribuneindia.com/news/business/govt-notifies-digital-personal-data-protection-rules-rollout-in-phases-specified-obligations-for-data-fiduciaries
