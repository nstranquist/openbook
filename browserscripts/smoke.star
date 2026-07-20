# Shell-health smoke for any web app. Run:
#   ndev browser open ob && \
#   ndev browser script run browserscripts/smoke.star --session ob \
#     --var base=http://localhost:5179/ --var expect=Openbook
#
# Asserts: page reachable, no client-side JS exceptions on load, title matches.
base = params["base"]
nav(base)
wait("body")

# Gate: fail the run if the page's OWN JS throws on load (kind="js" drops
# network/resource chatter). This is the "did the bundle crash" check.
console(reload=True, window="2500ms", kind="js", fail_on_error=True)

title = eval("document.title")          # eval returns JSON-encoded → has quotes
emit({"url": base, "title": title})

want = params.get("expect", "")
if want and want not in title:
    fail("expected title to contain %r, got %s" % (want, title))
