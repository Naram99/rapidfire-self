# Rapidfire frontend design

The app is a realtime quiz for short solo rounds and games with friends. The
provided `apps/web/index.css` palette and font variables are the source of truth.

## Tokens and typography

- Ember action: `#f56800` / `#ff8c2a`, with dark ember text for readable buttons.
- Ash canvas: `#f7f5f3` / `#141210`; surfaces and text use the same ash scale.
- Blaze error: `#b32110`; spark warning: `#4a3700`; velocity success: `#062d73`.
- Bebas Neue: wordmark, short display headings and countdown. DM Sans: questions,
  answers, forms and prose. DM Mono: room code and compact game numbers.
- Semantic aliases map the supplied palette to surfaces, text, borders, focus,
  controls and feedback. Light and dark modes follow the system preference.
- Small brand text uses ember-700 in light mode. Ember-600 on the ash canvas
  measures 4.35:1 and on ember-100 measures 3.76:1; the darker alias clears the
  4.5:1 normal-text target while retaining the provided palette.
- Spacing follows a 4/8px rhythm. Body text starts at 16px; controls are at least
  48px tall. Content width, safe areas and text size remain responsive.

## Layout

Left-align normal content. The game question is the visual focus; the countdown
alone is centered. On a phone, all answers precede the participant list. On a
desktop, the quiz and compact participant panel share a grid.

```text
Phone                   Desktop
brand / account         brand                         account
intro                   intro             solo / friends
solo / friends          ------------------------------
------------------      round / category               time
round / time            question             participants
question                answer    answer     score / state
answer                  answer    answer
answer                  confirm
confirm (multiple choice only)
participants
```

## Design review before implementation

The frontend-design, ui-ux-pro-max and React skills were read. The local design
searches matched gaming/trivia, but the first suggested an expensive 3D showcase
and the second a generic testimonial landing page. Those page patterns do not
fit an actual quiz app and are not adopted. The useful low-cost, high-contrast,
keyboard and touch guidance informs this plan; the user's palette and fonts take
precedence over the generated palette/font recommendations.

The memorable element is the tall display typography and restrained flame mark.
There are no invented players, rankings, testimonials or decorative stat cards.
Status communicates real server state. Color always accompanies text or a symbol.
Questions and options are mounted only when the server opens the question.

## Interaction and accessibility

- Real links and native controls support keyboard, touch and password managers.
- Single-choice answer buttons submit immediately on tap or Enter/Space;
  multiple-choice checkboxes retain a separate confirmation.
- The home title cycles quiz verbs beside a fixed "Fast." with reserved grid
  space, pause/resume controls, focus/visibility pause and a reduced-motion still.
  The screen-reader heading stays stable; decorative word changes are hidden.
- Inline field errors, a focused error summary, semantic headings and a skip link.
- Native confirmation dialogs for leaving a game and deleting an account.
- A disconnected client retains its view and blocks mutation until recovery.
- Visible focus, reduced-motion support, safe-area padding and wrapping long names.
- Route changes and game phases move focus to the main content; ticking timers
  do not produce repeated live-region announcements.
- English copy lives in a replaceable catalog. Dates and numbers use Intl.

## Verification targets

Review screenshots at 375px, tablet/landscape and 1440px, both color schemes,
reduced motion and enlarged text. Exercise guest games, real two-user games,
shared answer locking, reconnect, auth forms, profile/history and deletion in
Playwright. The Web Interface Guidelines source was fetched for the final review.
