namespace Normative
{
    partial class SelfPropStandard
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.gdv_standard = new System.Windows.Forms.DataGridView();
            this.btn_Import = new System.Windows.Forms.Button();
            this.btn_clear = new System.Windows.Forms.Button();
            this.PurchasingStatus = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.StandardStatus = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.StandardNo = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.StandardName = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.FileName = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.PublishDate = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.ImplementDate = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.RepealDate = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.MessInfo = new System.Windows.Forms.DataGridViewTextBoxColumn();
            ((System.ComponentModel.ISupportInitialize)(this.gdv_standard)).BeginInit();
            this.SuspendLayout();
            // 
            // gdv_standard
            // 
            this.gdv_standard.AllowUserToAddRows = false;
            this.gdv_standard.Anchor = ((System.Windows.Forms.AnchorStyles)((((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom) 
            | System.Windows.Forms.AnchorStyles.Left) 
            | System.Windows.Forms.AnchorStyles.Right)));
            this.gdv_standard.BackgroundColor = System.Drawing.SystemColors.ButtonHighlight;
            this.gdv_standard.ColumnHeadersHeightSizeMode = System.Windows.Forms.DataGridViewColumnHeadersHeightSizeMode.AutoSize;
            this.gdv_standard.Columns.AddRange(new System.Windows.Forms.DataGridViewColumn[] {
            this.PurchasingStatus,
            this.StandardStatus,
            this.StandardNo,
            this.StandardName,
            this.FileName,
            this.PublishDate,
            this.ImplementDate,
            this.RepealDate,
            this.MessInfo});
            this.gdv_standard.Location = new System.Drawing.Point(12, 49);
            this.gdv_standard.Name = "gdv_standard";
            this.gdv_standard.RowTemplate.Height = 23;
            this.gdv_standard.Size = new System.Drawing.Size(675, 403);
            this.gdv_standard.TabIndex = 22;
            this.gdv_standard.RowPostPaint += new System.Windows.Forms.DataGridViewRowPostPaintEventHandler(this.gdv_model_RowPostPaint);
            // 
            // btn_Import
            // 
            this.btn_Import.Location = new System.Drawing.Point(12, 12);
            this.btn_Import.Name = "btn_Import";
            this.btn_Import.Size = new System.Drawing.Size(75, 23);
            this.btn_Import.TabIndex = 23;
            this.btn_Import.Text = "导入";
            this.btn_Import.UseVisualStyleBackColor = true;
            this.btn_Import.Click += new System.EventHandler(this.btn_Import_Click);
            // 
            // btn_clear
            // 
            this.btn_clear.Location = new System.Drawing.Point(93, 12);
            this.btn_clear.Name = "btn_clear";
            this.btn_clear.Size = new System.Drawing.Size(75, 23);
            this.btn_clear.TabIndex = 24;
            this.btn_clear.Text = "清空";
            this.btn_clear.UseVisualStyleBackColor = true;
            this.btn_clear.Click += new System.EventHandler(this.btn_clear_Click);
            // 
            // PurchasingStatus
            // 
            this.PurchasingStatus.DataPropertyName = "PurchasingStatus";
            this.PurchasingStatus.HeaderText = "采购状态";
            this.PurchasingStatus.Name = "PurchasingStatus";
            this.PurchasingStatus.ReadOnly = true;
            this.PurchasingStatus.Visible = false;
            this.PurchasingStatus.Width = 80;
            // 
            // StandardStatus
            // 
            this.StandardStatus.DataPropertyName = "StandardStatus";
            this.StandardStatus.HeaderText = "状态";
            this.StandardStatus.Name = "StandardStatus";
            this.StandardStatus.ReadOnly = true;
            this.StandardStatus.Visible = false;
            this.StandardStatus.Width = 60;
            // 
            // StandardNo
            // 
            this.StandardNo.DataPropertyName = "StandardNo";
            this.StandardNo.HeaderText = "标准编号";
            this.StandardNo.Name = "StandardNo";
            this.StandardNo.ReadOnly = true;
            this.StandardNo.Width = 150;
            // 
            // StandardName
            // 
            this.StandardName.DataPropertyName = "StandardName";
            this.StandardName.HeaderText = "标准名称";
            this.StandardName.Name = "StandardName";
            this.StandardName.ReadOnly = true;
            this.StandardName.Width = 350;
            // 
            // FileName
            // 
            this.FileName.DataPropertyName = "FileName";
            this.FileName.HeaderText = "文件名称";
            this.FileName.Name = "FileName";
            this.FileName.ReadOnly = true;
            this.FileName.Visible = false;
            this.FileName.Width = 80;
            // 
            // PublishDate
            // 
            this.PublishDate.DataPropertyName = "PublishDate";
            this.PublishDate.HeaderText = "发布日期";
            this.PublishDate.Name = "PublishDate";
            this.PublishDate.ReadOnly = true;
            this.PublishDate.Visible = false;
            this.PublishDate.Width = 80;
            // 
            // ImplementDate
            // 
            this.ImplementDate.DataPropertyName = "ImplementDate";
            this.ImplementDate.HeaderText = "实施日期";
            this.ImplementDate.Name = "ImplementDate";
            this.ImplementDate.ReadOnly = true;
            // 
            // RepealDate
            // 
            this.RepealDate.DataPropertyName = "RepealDate";
            this.RepealDate.HeaderText = "废止日期";
            this.RepealDate.Name = "RepealDate";
            this.RepealDate.ReadOnly = true;
            this.RepealDate.Visible = false;
            this.RepealDate.Width = 80;
            // 
            // MessInfo
            // 
            this.MessInfo.DataPropertyName = "MessInfo";
            this.MessInfo.HeaderText = "提示信息";
            this.MessInfo.Name = "MessInfo";
            this.MessInfo.ReadOnly = true;
            this.MessInfo.Visible = false;
            this.MessInfo.Width = 130;
            // 
            // SelfPropStandard
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(6F, 12F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.ClientSize = new System.Drawing.Size(695, 461);
            this.Controls.Add(this.btn_clear);
            this.Controls.Add(this.btn_Import);
            this.Controls.Add(this.gdv_standard);
            this.Name = "SelfPropStandard";
            this.ShowIcon = false;
            this.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
            this.Text = "自行导入标准";
            this.Load += new System.EventHandler(this.SelfPropStandard_Load);
            ((System.ComponentModel.ISupportInitialize)(this.gdv_standard)).EndInit();
            this.ResumeLayout(false);

        }

        #endregion

        private System.Windows.Forms.DataGridView gdv_standard;
        private System.Windows.Forms.Button btn_Import;
        private System.Windows.Forms.Button btn_clear;
        private System.Windows.Forms.DataGridViewTextBoxColumn PurchasingStatus;
        private System.Windows.Forms.DataGridViewTextBoxColumn StandardStatus;
        private System.Windows.Forms.DataGridViewTextBoxColumn StandardNo;
        private System.Windows.Forms.DataGridViewTextBoxColumn StandardName;
        private System.Windows.Forms.DataGridViewTextBoxColumn FileName;
        private System.Windows.Forms.DataGridViewTextBoxColumn PublishDate;
        private System.Windows.Forms.DataGridViewTextBoxColumn ImplementDate;
        private System.Windows.Forms.DataGridViewTextBoxColumn RepealDate;
        private System.Windows.Forms.DataGridViewTextBoxColumn MessInfo;
    }
}