using Normative.Context;
using System;
using System.IO;
using System.Reflection;
using System.ServiceModel;
using System.ServiceModel.Channels;
using System.Windows.Forms;

namespace Normative.Client
{
    public class BaseClient<T>
    {
        private T proxy;

        public void Close()
        {
            if (this.proxy != null)
            {
                var c = (IChannel)this.proxy;

                if (c.State != CommunicationState.Closing && c.State != CommunicationState.Closed)
                {
                    c.Close();
                }
            }
        }

        public T CreateProxy()
        {
            try
            {
                var configFile = @"\\10.102.2.77\Evars\E3D\PDMSTOOLS\Normative\Client.config";
                var channel = new CustomClientChannel<T>(configFile);
                this.proxy = channel.CreateChannel();

                return this.proxy;
            }
            catch (Exception e)
            {
                GlobalHelper.appendlog(e.ToString());
                return this.proxy;
            }
        }
    }
}
