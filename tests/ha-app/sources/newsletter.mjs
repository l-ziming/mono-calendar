import assert from 'node:assert/strict';
import { newsletterCandidate } from '../../../ha-app/server/sources/newsletter.mjs';

const options = { now: new Date('2026-11-07T17:00:00Z'), timezone: 'America/Denver' };
const fixture = {
  state: '2026-11-07T17:00:00Z',
  last_updated: '2026-11-07T17:00:00Z',
  attributes: {
    subject: 'The Morning: Community update',
    sender: 'The New York Times <nytdirect@nytimes.com>',
    date: 'Sat, 07 Nov 2026 08:00:00 -0500',
    body: 'A community exhibit opens this afternoon.\nRead more: https://www.nytimes.com/2026/11/07/us/example.html?subscriber=private-id#section\n\nYou received this email because you subscribed.\nreader@example.test\nUnsubscribe https://nl.nytimes.com/unsubscribe/private-id',
    username: 'private-mailbox@example.test',
    headers: { To: 'private-recipient@example.test' },
    body_html: 'private-html-sentinel',
  },
};
const withAttrs = (attrs) => ({ ...fixture, attributes: { ...fixture.attributes, ...attrs } });
const candidate = newsletterCandidate(fixture, options);
assert.equal(candidate.title, fixture.attributes.subject);
assert.match(candidate.summary, /community exhibit/);
assert.equal(candidate.date, '2026-11-07T13:00:00.000Z');
assert.equal(candidate.site, 'The New York Times');
assert.equal(candidate.scope, 'general');
assert.equal(candidate.url, 'https://www.nytimes.com/2026/11/07/us/example.html');
assert.match(candidate.id, /^nyt-mail:[a-f0-9]{64}$/);
assert.ok(!/private|example\.test|nytdirect|unsubscribe|https?:/i.test(candidate.summary));
assert.ok(!/private-|username|headers|body_html|sender|@/.test(JSON.stringify(candidate)));
assert.deepEqual(newsletterCandidate(fixture, options), candidate, 'The same issue has a stable ID');
assert.equal(
  newsletterCandidate(
    withAttrs({ body: fixture.attributes.body.replaceAll('private-id', 'different-tracking') }),
    options,
  ).id,
  candidate.id,
  'Tracking changes do not create a new issue',
);
assert.notEqual(newsletterCandidate(withAttrs({ subject: 'Another issue' }), options).id, candidate.id);
for (const sender of ['nyt@service.newyorktimes.com', 'editor@news.nytimes.com']) {
  assert.ok(newsletterCandidate(withAttrs({ sender }), options));
}
const relaySender = 'nytdirect_at_nytimes_com_abc123_def456@privaterelay.appleid.com';
for (const sender of [
  relaySender,
  `The New York Times <${relaySender}>`,
  'nyt_at_newyorktimes_com_abc123_def456@privaterelay.appleid.com',
]) {
  assert.ok(
    newsletterCandidate(withAttrs({ sender }), options),
    'NYT-specific Apple relay addresses also require an NYT link',
  );
}
for (const sender of [
  'other_abc123@privaterelay.appleid.com',
  'other_at_example_com_abc123@privaterelay.appleid.com',
  'nytdirect_at_nytimes_com_abc123@privaterelay.appleid.com.evil.test',
  'nytdirect_at_nytimes_com_abc123@example.test',
]) {
  assert.equal(
    newsletterCandidate(withAttrs({ sender }), options),
    null,
    'Other Apple relays and lookalike domains are not NYT',
  );
}
for (const body of [
  'A news update without any link.',
  'A news update https://nytimes.com.evil.test/article',
  'A news update https://nytimes.com@evil.test/article',
  'A news update https://evil.test/nytimes.com/article',
]) {
  assert.equal(
    newsletterCandidate(withAttrs({ sender: relaySender, body }), options),
    null,
    'Apple relay text must carry a real NYT-hosted URL',
  );
}
assert.equal(
  newsletterCandidate(withAttrs({ sender: relaySender, date: '2025-07-25T13:00:00Z' }), options),
  null,
  'Relay recognition never refreshes an archived issue',
);
assert.ok(!JSON.stringify(newsletterCandidate(withAttrs({ sender: relaySender }), options)).includes('privaterelay'));
for (const sender of [
  'The New York Times <attacker@example.test>',
  'nyt@nytimes.com.evil.test',
  'nytimes.com',
  'attacker@notnytimes.com',
]) {
  assert.equal(newsletterCandidate(withAttrs({ sender }), options), null, 'A display name is not an NYT source');
}
for (const state of [
  null,
  { ...fixture, state: 'unknown' },
  { ...fixture, state: 'unavailable' },
  withAttrs({ body: '' }),
  withAttrs({ subject: '' }),
  withAttrs({ date: 'invalid' }),
  withAttrs({ sender: null }),
]) {
  assert.equal(newsletterCandidate(state, options), null);
}
assert.equal(
  newsletterCandidate(withAttrs({ date: '2026-11-07T02:00:00Z' }), options),
  null,
  'UTC today can still be yesterday locally',
);
assert.equal(
  newsletterCandidate(withAttrs({ date: '2026-11-07T18:00:00Z' }), options),
  null,
  'A future Date is rejected',
);
assert.equal(
  newsletterCandidate(withAttrs({ date: '2026-11-06T13:00:00Z' }), options),
  null,
  "A fresh state/receipt does not refresh yesterday's issue",
);
const forward = withAttrs({
  sender: 'Reader <reader@example.test>',
  subject: 'Fwd: The Morning',
  date: '2026-11-07T16:00:00Z',
  body: 'Personal introductory note, do not share.\nBegin forwarded message:\nFrom: The New York Times <nytdirect@nytimes.com>\nDate: Sat, 07 Nov 2026 08:00:00 -0500\nTo: private-recipient@example.test\nSubject: The Morning: Community update\n\nA community exhibit opens this afternoon.\nhttps://www.nytimes.com/2026/11/07/us/example.html?reader=private-id',
});
const forwarded = newsletterCandidate(forward, options);
assert.equal(forwarded.date, '2026-11-07T13:00:00.000Z');
assert.equal(forwarded.title, 'The Morning: Community update');
assert.ok(!/Personal|private-|reader@|From:|To:|Date:|Subject:/.test(JSON.stringify(forwarded)));
assert.equal(
  newsletterCandidate(
    { ...forward, attributes: { ...forward.attributes, body: forward.attributes.body.replace('07 Nov', '06 Nov') } },
    options,
  ),
  null,
  'A new forward cannot make an old issue fresh',
);
assert.equal(
  newsletterCandidate(
    { ...forward, attributes: { ...forward.attributes, body: forward.attributes.body.replace(/^Date:.*\n/m, '') } },
    options,
  ),
  null,
  'A forward without original Date is not dated from receipt',
);
assert.equal(
  newsletterCandidate(
    {
      ...forward,
      attributes: {
        ...forward.attributes,
        body: forward.attributes.body.replaceAll('www.nytimes.com', 'www.nytimes.com.evil.test'),
      },
    },
    options,
  ),
  null,
);
const html = newsletterCandidate(
  withAttrs({
    body: '<p>Public news &amp; updates.</p><script>private-script</script><p>Contact reader@example.test.</p><a href="https://nl.nytimes.com/private-link">Read the story</a>',
  }),
  options,
);
assert.match(html.summary, /Public news & updates/);
assert.ok(!/private|reader@|<[^>]*>/.test(html.summary));
const long = newsletterCandidate(withAttrs({ subject: '中'.repeat(300), body: '中'.repeat(14000) }), options);
assert.equal([...long.title].length, 240);
assert.equal([...long.summary].length, 12000);
for (const marker of [
  'ADVERTISEMENT',
  'Paid Post',
  'Sponsored Content',
  'A message from Example Brand',
  'Supported by Example Brand',
]) {
  const ad = newsletterCandidate(
    withAttrs({ body: `Opening news.\n${marker}\nBuy our product.\nContinue reading the main story\nClosing news.` }),
    options,
  );
  assert.match(ad.summary, /Opening news/);
  assert.match(ad.summary, /Closing news/);
  assert.ok(!/product|Example Brand|Paid Post/i.test(ad.summary));
  assert.equal(
    newsletterCandidate(
      withAttrs({ body: `Opening news.\n${marker}\nUnbounded promotion and anything after it.` }),
      options,
    ).summary,
    'Opening news.',
  );
}
assert.equal(newsletterCandidate(withAttrs({ body: 'ADVERTISEMENT\nOnly a promotion.' }), options), null);
const editorial = newsletterCandidate(
  withAttrs({ body: 'Opening news.\nADVERTISEMENT\nBuy this.\nTHE LATEST NEWS\nA reported event.' }),
  options,
);
assert.match(editorial.summary, /A reported event/);
assert.ok(!editorial.summary.includes('Buy this'));
const ordinary =
  'The report examines advertising revenue.\nA sponsor funded the project, the newspaper reported.\nThe company sponsored a public event.';
assert.equal(
  newsletterCandidate(withAttrs({ body: ordinary }), options).summary,
  ordinary,
  'Ordinary reporting about advertising and sponsors remains intact',
);
assert.equal(
  newsletterCandidate(withAttrs({ body: 'Reported facts.\nSubscribe now\nMore reported facts.' }), options).summary,
  'Reported facts.\nMore reported facts.',
);
assert.equal(
  newsletterCandidate(withAttrs({ body: 'Subscribe now\nReported facts.' }), options).summary,
  'Reported facts.',
  'A header CTA must not discard the newsletter',
);
for (const ad of [
  '<!-- AD START --><p>Paid product.</p><!-- AD END -->',
  '<div data-ad-slot="newsletter"><div>Paid product.</div><p>More promotion.</p></div>',
  '<section class="sponsored-content"><p>Paid product.</p></section>',
]) {
  const result = newsletterCandidate(withAttrs({ body: `<p>Opening news.</p>${ad}<p>Closing news.</p>` }), options);
  assert.match(result.summary, /Opening news/);
  assert.match(result.summary, /Closing news/);
  assert.ok(!/Paid product|promotion/.test(result.summary));
}
assert.equal(
  newsletterCandidate(withAttrs({ body: '<p>Opening news.</p><div data-ad="true"><p>Unclosed promotion.' }), options)
    .summary,
  'Opening news.',
);
assert.match(
  newsletterCandidate(
    withAttrs({ body: '<div class="advertising-report"><p>News about advertising.</p></div>' }),
    options,
  ).summary,
  /News about advertising/,
);
assert.match(
  newsletterCandidate(
    withAttrs({ body: '<div class="advertisement-policy"><p>News about advertising.</p></div>' }),
    options,
  ).summary,
  /News about advertising/,
);
console.log(
  'Newsletter: NYT source hints, forwarding issue dates, local-day freshness, privacy, tracking/footer cleanup and limits checked.',
);
