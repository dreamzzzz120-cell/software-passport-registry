/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IMPORTANT ROUTING BOUNDARY
 *
 * /privacy is the public legal Privacy Policy route. It must never render
 * authenticated Privacy Management UI, even when Firebase restores a session
 * in the browser. The old Privacy Management screen collided with this public
 * URL and could make the public policy appear to be an authenticated app page.
 *
 * Keep the legal document isolated here until Privacy Management is given its
 * own explicit authenticated route. This component intentionally performs no
 * API calls and renders no tenant/workspace data.
 */
import PrivacyPolicyView from './legal/PrivacyPolicyView';

export default function PrivacyView() {
  return <PrivacyPolicyView />;
}
