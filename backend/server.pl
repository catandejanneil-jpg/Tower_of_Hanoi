% ============================================================
%  Tower of Hanoi - Prolog backend (SWI-Prolog)
%  Run with:  swipl server.pl
%  API:       GET http://localhost:8000/solve?disks=N   (N = 1..8)
%  Website:   http://localhost:8000/   (served from ../frontend)
% ============================================================

:- use_module(library(lists)).
:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_parameters)).
:- use_module(library(http/http_json)).
:- use_module(library(http/http_cors)).
:- use_module(library(http/http_files)).

% CORS: allow any website origin to call this API.
:- set_setting(http:cors, [*]).

% ---------- Routes ----------
:- http_handler(root(solve), solve_handler, []).
:- http_handler(root(.),     serve_frontend, [prefix]).

% ---------- Find the frontend folder (../frontend) ----------
:- dynamic frontend_dir/1.
:- prolog_load_context(directory, Dir),
   absolute_file_name('../frontend', Path,
                      [relative_to(Dir), file_type(directory)]),
   asserta(frontend_dir(Path)).

serve_frontend(Request) :-
    frontend_dir(Dir),
    http_reply_from_files(Dir, [], Request).

% ---------- The puzzle: recursive solver ----------
% hanoi(+N, +From, +To, -Moves)
% Moves is the list of move(From,To) terms that moves N disks
% from peg From to peg To.

peg(left).
peg(middle).
peg(right).

% spare(+A, +B, -Via): Via is the third peg (not A and not B).
spare(A, B, Via) :-
    peg(Via),
    Via \== A,
    Via \== B,
    !.

% Base case: 0 disks need 0 moves.
hanoi(0, _, _, []) :- !.

% Recursive case:
%   1) move N-1 disks From -> Via
%   2) move the biggest disk From -> To
%   3) move N-1 disks Via -> To
hanoi(N, From, To, Moves) :-
    N > 0,
    N1 is N - 1,
    spare(From, To, Via),
    hanoi(N1, From, Via, Moves1),
    hanoi(N1, Via, To, Moves2),
    append(Moves1, [move(From, To) | Moves2], Moves).

% ---------- HTTP handler for /solve?disks=N ----------
solve_handler(Request) :-
    cors_enable,                                  % add CORS header
    http_parameters(Request,
                    [ disks(N, [between(1, 8)]) ]), % read and check ?disks=
    hanoi(N, left, right, Moves),
    length(Moves, Total),
    maplist(move_to_dict, Moves, MoveDicts),
    reply_json_dict(_{ disks: N, total: Total, moves: MoveDicts }).

move_to_dict(move(From, To), _{from: From, to: To}).

% ---------- Start the server ----------
:- initialization(main, main).

main :-
    http_server(http_dispatch, [port(8000)]),
    format("Tower of Hanoi server is running.~n"),
    format("Open http://localhost:8000 in your browser.~n"),
    format("Press Ctrl+C to stop.~n"),
    thread_get_message(_).    % keep the program alive