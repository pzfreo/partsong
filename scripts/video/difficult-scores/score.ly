\version "2.24.0"
% In the Bleak Midwinter (Holst, "Cranham"), re-engraved as a deliberately
% awkward layout for Partsong's "difficult scores" video: verse 1 on four
% staves, verse 4 hymn-style on two (S+A, T+B). Layout tweaks below make
% some systems hard to find.

#(set-global-staff-size 16)
\paper {
  #(set-paper-size "a4")
  top-margin = 12\mm bottom-margin = 12\mm left-margin = 16\mm right-margin = 16\mm
  indent = 16\mm short-indent = 6\mm
  print-page-number = ##t
  ragged-last-bottom = ##t
  ragged-bottom = ##t
  tagline = \markup \small "Demonstration layout · music and words public domain"
}
\header {
  title = "In the Bleak Midwinter"
  subtitle = "Cranham"
  poet = "Christina Rossetti (1830–1894)"
  composer = "Gustav Holst (1874–1934)"
}
global = { \key f \major \time 4/4 }
split = \overrideProperty Score.NonMusicalPaperColumn.line-break-system-details #'((alignment-distances . (12 24 12)))
breaksOne = { \alterBroken transparent #'(#f #t #f #f) Score.SystemStartBar \alterBroken transparent #'(#f #t #f #f) ChoirStaff.SystemStartBracket s1*4 \break \noPageBreak \split s1*4 \break \noPageBreak s1*4 \break \noPageBreak s1*4 }
at = #(define-music-function (y) (number?) #{ \overrideProperty Score.NonMusicalPaperColumn.line-break-system-details #`((Y-offset . ,y)) #})
breaksFour = { \partial 4 \at 4 s4 s1*4 \break \at 34 s1*4 \break \at 55 s1*4 \break \at 90 s1*3 s2. }

% ---- Verse 1 (four staves) ----
sOne = \relative c'' { a4. bes8 c4 a | g2 f | g4. a8 g4 d | g1 | a4. bes8 c4 a | g4.( g8) f2 | g4 a g4. f8 | f2. r4 |
  bes4. a8 bes4 c | d4 d a( a) | c( a) g( f) | e2. r4 | a4. bes8 c4 a | g2 f | g4( a) g4. f8 | f2. r4 \bar "|." }
aOne = \relative c' { f4. f8 f4 c | d2 d | d4. d8 d4 c | bes1 | c4. f8 f4 c | d4.( d8) d2 | f4 f e4. f8 | f2. r4 |
  f4. f8 f4 es | d4 d f( f) | f( e) d( d) | c2. r4 | c4. f8 f4 c | d2 d | f2 e4. f8 | f2. r4 }
tOne = \relative c' { c4. c8 c4 f, | a2 a | g4. d8 d4 f | f2( e) | f4. c'8 c4 f, | a4.( a8) a2 | d4 d bes4. a8 | a2. r4 |
  bes4. c8 bes4 a | bes4 bes a( a) | f( c') bes( a) | g2. r4 | f4. c'8 c4 f, | a2 a | d2 bes4. a8 | a2. r4 }
bOne = \relative c { f4. g8 a4 f | d2 d | bes4. c8 bes4 a | g2( c) | f4. g8 a4 f | d4.( d8) d2 | bes4 bes c4. f8 | f2. r4 |
  d4. f8 d4 c | bes4 bes d( d) | a( a) bes( bes) | c2. r4 | f4. g8 a4 f | d2 d | bes2 c4. f8 | f2. r4 }
wordsOne = \lyricmode {
  In the bleak mid -- win -- ter frost -- y wind made moan, earth stood hard as i -- ron, wa -- ter like a stone;
  snow had fal -- len, snow on snow, snow on snow, in the bleak mid -- win -- ter, long, long a -- go.
}

% ---- Verse 4 (two staves) ----
sFour = \relative c'' { \partial 4 r4 | a4.( bes8) c4 a | g2 f | g4.( a8) g4 d | g1 | a4. bes8 c4 a | g4.( g8) f2 | g4 a g4. f8 | f2. r4 |
  bes4. a8 bes4 c | d4( d) a( a) | c a g f | e2. a4 | a4.( bes8) c4 a | g2 f | g4( a) g4.( f8) | f2. \bar "|." }
aFour = \relative c' { \partial 4 r4 | f4.( f8) f4 c | d2 d | d4.( d8) d4 c | bes1 | c4. f8 f4 c | d4.( d8) d2 | f4 f e4. f8 | f2. r4 |
  f4. f8 f4 es | d4( d) f( f) | f e d d | c2. c4 | c4.( f8) f4 c | d2 d | f2 e4.( f8) | f2. }
tFour = \relative c' { \partial 4 r4 | c4.( c8) c4 f, | a2 a | g4.( d8) d4 f | f2( e) | f4. c'8 c4 f, | a4.( a8) a2 | d4 d bes4. a8 | a2. r4 |
  bes4. c8 bes4 a | bes4( bes) a( a) | f c' bes a | g2. f4 | f4.( c'8) c4 f, | a2 a | d2 bes4.( a8) | a2. }
bFour = \relative c { \partial 4 r4 | f4.( g8) a4 f | d2 d | bes4.( c8) bes4 a | g2( c) | f4. g8 a4 f | d4.( d8) d2 | bes4 bes c4. f8 | f2. r4 |
  d4. f8 d4 c | bes4( bes) d( d) | a a bes bes | c2. f4 | f4.( g8) a4 f | d2 d | bes2 c4.( f8) | f2. }
wordsFour = \lyricmode {
  What can I give him, poor as I am? If I were a shep -- herd I would bring a lamb;
  if I were a wise man I would do my part; yet what can I give him: give my heart.
}

\score {
  \new ChoirStaff <<
    \new StaffGroup \with { systemStartDelimiter = #'SystemStartSquare } <<
    \new Staff \with { instrumentName = "Soprano" shortInstrumentName = "S" } { \global \new Voice = "s1" << \sOne \breaksOne >> }
    \new Lyrics \lyricsto "s1" \wordsOne
    \new Staff \with { instrumentName = "Alto" shortInstrumentName = "A" } { \global \aOne }
    \new Lyrics \lyricsto "s1" \wordsOne
    >>
    \new StaffGroup \with { systemStartDelimiter = #'SystemStartSquare } <<
    \new Staff \with { instrumentName = "Tenor" shortInstrumentName = "T" } { \global \clef "treble_8" \tOne }
    \new Lyrics \lyricsto "s1" \wordsOne
    \new Staff \with { instrumentName = "Bass" shortInstrumentName = "B" } { \global \clef bass \bOne }
    >>
  >>
  \header { piece = "1." }
  \layout { }
}
\pageBreak

\score {
  \new ChoirStaff <<
    \new Staff \with { instrumentName = "S A" } <<
      \global
      \new Voice = "s4" { \voiceOne << \sFour \breaksFour >> }
      \new Voice { \voiceTwo \aFour }
    >>
    \new Lyrics \lyricsto "s4" \wordsFour
    \new Staff \with { instrumentName = "T B" } <<
      \global \clef bass
      \new Voice { \voiceOne \tFour }
      \new Voice { \voiceTwo \bFour }
    >>
  >>
  \header { piece = "4." }
  \layout { }
}
